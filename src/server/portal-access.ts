import "server-only";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action";
import { normalizeBdPhone, phoneVariants } from "@/lib/phone";
import { logChanges } from "@/lib/audit";
import { notify } from "./notify";
import { customerLedger } from "./ledger";

/**
 * Which customers a portal login may act for. A customer's own login: just
 * that customer. An agent: the customers assigned to them, read fresh on every
 * request so un-assigning a customer takes effect at once.
 *
 * Portal pages and actions resolve the record's customer here first, then call
 * the existing portal functions with it (which check ownership again).
 */
export type PortalLogin = { id: string; name: string; kind: "CUSTOMER" | "AGENT"; customer: { id: string } | null };

export async function allowedCustomerIds(acc: PortalLogin): Promise<string[]> {
  if (acc.kind === "CUSTOMER") return acc.customer ? [acc.customer.id] : [];
  const rows = await prisma.customer.findMany({ where: { agentAccountId: acc.id }, select: { id: true } });
  return rows.map((r) => r.id);
}

export type PortalRecord = "order" | "shipping" | "sample" | "estimate";

/** The customer a record belongs to, if this login may see it; else null. */
export async function ownerOf(acc: PortalLogin, kind: PortalRecord, id: string): Promise<string | null> {
  const ids = await allowedCustomerIds(acc);
  if (!ids.length) return null;
  const where = { id, customerId: { in: ids } };
  const row =
    kind === "order"
      ? await prisma.order.findFirst({ where, select: { customerId: true } })
      : kind === "shipping"
        ? await prisma.shippingOrder.findFirst({ where, select: { customerId: true } })
        : kind === "sample"
          ? await prisma.sample.findFirst({ where, select: { customerId: true } })
          : await prisma.estimate.findFirst({ where: { id, order: { customerId: { in: ids } } }, select: { order: { select: { customerId: true } } } }).then((e) => (e ? { customerId: e.order.customerId } : null));
  return row?.customerId ?? null;
}

/** Like ownerOf, for actions: throws "Not found" instead of returning null. */
export async function requireOwner(acc: PortalLogin, kind: PortalRecord, id: string): Promise<string> {
  const c = await ownerOf(acc, kind, id);
  if (!c) throw new UserError("Not found");
  return c;
}

/** Who a new request is for: a customer orders for themselves; an agent picks one of their customers. */
export async function customerForNew(acc: PortalLogin, picked: string | undefined): Promise<string> {
  if (acc.kind === "CUSTOMER") {
    if (!acc.customer) throw new UserError("Not found");
    return acc.customer.id;
  }
  if (!picked) throw new UserError("Choose the customer this is for");
  if (!(await allowedCustomerIds(acc)).includes(picked)) throw new UserError("Customer not found");
  return picked;
}

/** For notifications and the record's "placed by". */
export const placedBy = (acc: PortalLogin) => ({ accountId: acc.id, agentName: acc.kind === "AGENT" ? acc.name : undefined });

const customerSelect = { id: true, code: true, name: true, phone: true, address: true, district: true, area: true } as const;

/** An agent's customers with what each owes. */
export async function agentCustomers(agentAccountId: string) {
  const list = await prisma.customer.findMany({ where: { agentAccountId }, orderBy: { name: "asc" }, select: customerSelect });
  return Promise.all(list.map(async (c) => ({ ...c, ledger: await customerLedger(c.id) })));
}

export type AgentCustomerInput = { name: string; phone: string; address: string; district?: string; area?: string };

/**
 * An agent adds a new customer and can order for them straight away. A phone
 * already on file is refused (it may be someone else's customer) – staff link
 * it to the agent instead.
 */
export async function agentAddCustomer(acc: PortalLogin, input: AgentCustomerInput) {
  if (acc.kind !== "AGENT") throw new UserError("Not found");
  const phone = normalizeBdPhone(input.phone);
  if (!phone) throw new UserError("Enter a valid Bangladesh mobile number (01XXXXXXXXX)");
  if (!input.name.trim() || !input.address.trim()) throw new UserError("Name and delivery address are required");
  const existing = await prisma.customer.findFirst({ where: { phone: { in: phoneVariants(phone) } }, select: { agentAccountId: true, code: true } });
  if (existing) {
    throw new UserError(existing.agentAccountId === acc.id ? `This customer is already in your list (${existing.code})` : "We already have a customer with this mobile number. Message us and we will add them to your list.");
  }
  const c = await prisma.$transaction(async (tx) => {
    const count = await tx.customer.count();
    const c = await tx.customer.create({
      data: {
        code: `C-${String(count + 1).padStart(5, "0")}`,
        name: input.name.trim(),
        phone,
        address: input.address.trim(),
        district: input.district?.trim() || null,
        area: input.area?.trim() || null,
        source: "PORTAL",
        agentAccountId: acc.id,
      },
      select: customerSelect,
    });
    await logChanges(tx, { entityType: "Customer", entityId: c.id, userId: null, action: "CREATE" });
    return c;
  });
  await notify("AGENT_CUSTOMER_ADDED", { ref: c.code, staffLink: `/customers/${c.id}` }, { name: c.name, phone: c.phone, agent: acc.name }, { accountId: acc.id });
  return c;
}
