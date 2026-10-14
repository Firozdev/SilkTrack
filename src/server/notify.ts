import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { docNo } from "@/lib/format";
import { RULES, type Channel, type EventType } from "@/lib/notifications/rules";
import { render, type Data } from "@/lib/notifications/templates";

/**
 * The one way to notify people:
 *   notify("QA_FAILED", { shipping: s, customerId: s.customerId }, { notes }, { userId: actor.id })
 *
 * Works out the recipients from RULES, writes the event (record history) and
 * one notification per recipient with the message and the right link (staff
 * page or portal page), and never notifies whoever caused it.
 */
export type About = {
  order?: { id: string; number: number };
  shipping?: { id: string; number: number };
  sample?: { id: string; number: number };
  shipment?: { id: string; code: string };
  issue?: { id: string; number: number };
  /** Whose order it is – their login and agent get customer-side events. */
  customerId?: string | null;
  /** Record number shown (and linked) in the message, if not the record's own. */
  ref?: string;
  /** Staff page to open, if not the record's own page. */
  staffLink?: string;
};
export type Cause = { userId?: string | null; accountId?: string | null };

type Db = Prisma.TransactionClient | typeof prisma;

function refOf(a: About) {
  if (a.ref) return a.ref;
  if (a.order) return docNo("order", a.order.number);
  if (a.shipping) return docNo("shippingOrder", a.shipping.number);
  if (a.sample) return docNo("sample", a.sample.number);
  if (a.issue) return docNo("issue", a.issue.number);
  if (a.shipment) return a.shipment.code;
  return "";
}

function staffLinkOf(a: About) {
  if (a.staffLink) return a.staffLink;
  if (a.order) return `/requests/${a.order.id}`;
  if (a.shipping) return `/shipping-orders/${a.shipping.id}`;
  if (a.sample) return `/samples/${a.sample.id}`;
  if (a.issue) return `/issues?id=${a.issue.id}`;
  if (a.shipment) return `/shipments/${a.shipment.id}`;
  return null;
}

function portalLinkOf(a: About) {
  if (a.order) return `/portal/requests/${a.order.id}`;
  if (a.shipping) return `/portal/shipping/${a.shipping.id}`;
  if (a.sample) return `/portal/samples/${a.sample.id}`;
  return "/portal";
}

/** Extra channels plug in here later (SMS / WhatsApp / email gateways); callers don't change. */
type Sender = (n: { title: string; body: string; customerId: string | null; link: string | null }) => Promise<void>;
const SENDERS: Partial<Record<Exclude<Channel, "IN_APP">, Sender>> = {};

export async function notify(type: EventType, about: About, data: Data = {}, cause: Cause = {}, db: Db = prisma) {
  try {
    await send(type, about, data, cause, db);
  } catch (e) {
    // A notification must never undo or block the action that triggered it.
    console.error(`notify(${type}) failed`, e);
  }
}

async function send(type: EventType, about: About, data: Data, cause: Cause, db: Db) {
  const rule = RULES[type];
  const customerId = about.customerId ?? null;
  const customer = customerId ? await db.customer.findUnique({ where: { id: customerId }, select: { name: true, code: true, agentAccountId: true } }) : null;
  const d: Data = { ...data, ref: refOf(about), customer: data.customer ?? (customer ? `${customer.name} (${customer.code})` : undefined) };

  const [users, accounts] = await Promise.all([
    rule.roles.length ? db.user.findMany({ where: { role: { in: rule.roles }, active: true, id: { not: cause.userId ?? undefined } }, select: { id: true } }) : [],
    rule.customer && customer
      ? db.portalAccount.findMany({
          where: {
            status: "ACTIVE",
            id: { not: cause.accountId ?? undefined },
            OR: [{ kind: "CUSTOMER", customerId: customerId! }, ...(customer.agentAccountId ? [{ kind: "AGENT" as const, id: customer.agentAccountId }] : [])],
          },
          select: { id: true, kind: true },
        })
      : [],
  ]);

  const event = await db.notificationEvent.create({
    data: {
      type,
      data: d as Prisma.InputJsonObject,
      orderId: about.order?.id,
      shippingOrderId: about.shipping?.id,
      sampleId: about.sample?.id,
      shipmentId: about.shipment?.id,
      issueId: about.issue?.id,
      customerId,
      actorUserId: cause.userId ?? null,
      actorAccountId: cause.accountId ?? null,
    },
  });
  if (!users.length && !accounts.length) return event;

  const staff = render(type, d, "staff");
  const staffLink = staffLinkOf(about);
  const portalLink = portalLinkOf(about);
  const base = { channel: "IN_APP" as const, type, eventId: event.id, orderId: about.order?.id ?? null, status: "SENT" as const, sentAt: new Date() };
  const rows: Prisma.NotificationCreateManyInput[] = [
    ...users.map((u) => ({ ...base, ...staff, userId: u.id, link: staffLink })),
    ...accounts.map((acc) => ({ ...base, ...render(type, d, "customer", acc.kind === "AGENT"), portalAccountId: acc.id, link: portalLink })),
  ];
  if (rows.length) await db.notification.createMany({ data: rows });

  for (const ch of rule.channels) {
    if (ch === "IN_APP") continue;
    const sender = SENDERS[ch];
    if (sender) await sender({ ...render(type, d, "customer"), customerId, link: portalLink });
  }
  return event;
}
