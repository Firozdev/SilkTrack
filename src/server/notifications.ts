import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { BD_TZ, ymdInTz } from "@/lib/dates";
import { RULES, type EventType } from "@/lib/notifications/rules";
import { render, type Data } from "@/lib/notifications/templates";
import { getCurrentRate } from "./rates";
import { notify } from "./notify";

/**
 * Reading notifications. Every query is scoped to one recipient – a staff
 * user or a portal login – so nobody can see or mark anyone else's.
 */
export type Recipient = { userId: string } | { accountId: string };

const mine = (r: Recipient): Prisma.NotificationWhereInput => ({ channel: "IN_APP", ...("userId" in r ? { userId: r.userId } : { portalAccountId: r.accountId }) });

export type FeedItem = { id: string; type: string; title: string; body: string; link: string | null; ref: string | null; read: boolean; createdAt: string };

const select = { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true, orderId: true, event: { select: { data: true } } } as const;
type Row = Prisma.NotificationGetPayload<{ select: typeof select }>;

function item(n: Row): FeedItem {
  const ref = (n.event?.data as Data | undefined)?.ref;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    // Older notifications (before links were stored) open their order.
    link: n.link ?? (n.orderId ? `/requests/${n.orderId}` : null),
    ref: typeof ref === "string" && ref ? ref : null,
    read: !!n.readAt,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Bell: unread count, the latest few, and anything new since `since` (for the toast + sound). */
export async function feed(r: Recipient, since?: Date) {
  const [unread, latest, fresh] = await Promise.all([
    prisma.notification.count({ where: { ...mine(r), readAt: null } }),
    prisma.notification.findMany({ where: mine(r), orderBy: { createdAt: "desc" }, take: 8, select }),
    since ? prisma.notification.findMany({ where: { ...mine(r), readAt: null, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 5, select }) : [],
  ]);
  return { unread, latest: latest.map(item), fresh: fresh.map(item), now: new Date().toISOString() };
}

/** "View all" page. */
export async function listNotifications(r: Recipient, opts: { unreadOnly?: boolean; type?: string; take?: number } = {}) {
  const where = { ...mine(r), ...(opts.unreadOnly ? { readAt: null } : {}), ...(opts.type ? { type: opts.type } : {}) };
  const [rows, types] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: opts.take ?? 100, select }),
    prisma.notification.groupBy({ by: ["type"], where: mine(r), _count: true }),
  ]);
  return { items: rows.map(item), types: types.map((t) => t.type).sort() };
}

export async function markRead(r: Recipient, id: string) {
  await prisma.notification.updateMany({ where: { ...mine(r), id, readAt: null }, data: { readAt: new Date(), status: "READ" } });
}

export async function markAllRead(r: Recipient) {
  await prisma.notification.updateMany({ where: { ...mine(r), readAt: null }, data: { readAt: new Date(), status: "READ" } });
}

export async function setSound(r: Recipient, on: boolean) {
  if ("userId" in r) await prisma.user.update({ where: { id: r.userId }, data: { notifySound: on } });
  else await prisma.portalAccount.update({ where: { id: r.accountId }, data: { notifySound: on } });
}

export type HistoryItem = { id: string; type: string; title: string; body: string; at: Date; toCustomer: boolean };

/**
 * A record's notification history (its own page). Staff see every event;
 * customers and agents only customer-side events, in customer wording.
 */
export async function recordHistory(about: { orderId?: string; shippingOrderId?: string; sampleId?: string }, audience: "staff" | "customer"): Promise<HistoryItem[]> {
  const events = await prisma.notificationEvent.findMany({ where: about, orderBy: { createdAt: "desc" }, take: 100 });
  return events
    .filter((e) => e.type in RULES && (audience === "staff" || RULES[e.type as EventType].customer))
    .map((e) => {
      const type = e.type as EventType;
      const t = render(type, e.data as Data, audience);
      return { id: e.id, type, ...t, at: e.createdAt, toCustomer: !!RULES[type].customer };
    });
}

export const RATE_REMINDER_HOUR = 10;

/**
 * No scheduler: the first time an Admin has the app open after 10:00 Bangladesh
 * time without today's rate, Admins are reminded – once per day.
 */
export async function ensureRateReminder(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: BD_TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < RATE_REMINDER_HOUR) return false;
  const { rate, isToday } = await getCurrentRate(now);
  if (isToday) return false;
  const day = ymdInTz(now, BD_TZ);
  return prisma.$transaction(async (tx) => {
    // Several Admins may poll at the same moment: one reminder per day.
    await tx.$executeRaw`select pg_advisory_xact_lock(73810)`;
    if (await tx.notificationEvent.findFirst({ where: { type: "RATE_MISSING", data: { path: ["day"], equals: day } }, select: { id: true } })) return false;
    await notify("RATE_MISSING", { staffLink: "/settings/exchange-rates" }, { day, lastDate: rate ? ymdInTz(rate.effectiveDate, "UTC") : undefined }, {}, tx);
    return true;
  });
}
