import "server-only";
import type { OrderStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { BD_TZ, CN_TZ, addDays, isoWeek, isoWeekStart, today } from "@/lib/dates";
import { D, sum } from "@/lib/money";
import { docNo } from "@/lib/format";
import { assertCan } from "@/lib/permissions";
import type { Actor } from "./actor";
import { ORDER_FLOW } from "./status";
import { purchaseQueue } from "./purchasing";
import { acceptingShipments } from "./shipments";
import { qaTodo } from "./order-qa";
import { awaitingQuoteWhere } from "./requests";
import { submissionNo } from "./payment-submissions";

const ACTIVE: OrderStatus[] = ORDER_FLOW.filter((s) => s !== "DELIVERED");

/** Orders per status (active pipeline), in lifecycle order. */
export async function ordersByStatus() {
  const rows = await prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: [...ACTIVE, "ON_HOLD"] } } });
  const map = new Map(rows.map((r) => [r.status, r._count._all]));
  return [...ACTIVE, "ON_HOLD" as const].map((s) => ({ status: s, count: map.get(s) ?? 0 }));
}

/** Bangladesh (CS) view. */
export async function bdDashboard() {
  const [withChina, sampling, quotationsToReview, quoted, upfrontRequested, priceApprovals, openIssues, payments, invoices] = await Promise.all([
    prisma.order.count({ where: { requestStatus: "NEW" } }),
    prisma.order.count({ where: { requestStatus: "SAMPLING" } }),
    // Quotations China submitted that BD still has to price / send.
    prisma.estimate.count({ where: { status: { in: ["SUBMITTED_BY_CHINA", "REVIEWED_BY_BD"] } } }),
    prisma.order.count({ where: { requestStatus: "QUOTED" } }),
    prisma.order.count({ where: { requestStatus: "CUSTOMER_APPROVED", advanceRequestedAt: { not: null }, payments: { none: { type: "ADVANCE" } }, status: { notIn: ["CANCELLED", "ON_HOLD"] } } }),
    prisma.purchaseLine.count({ where: { priceApproval: "PENDING" } }),
    prisma.issue.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.payment.findMany({ where: { order: { status: { not: "CANCELLED" } } }, select: { orderId: true, type: true, amountBdt: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { orderId: true, totalBdt: true } }),
  ]);
  // Balance to collect = issued invoices − payments on those orders.
  const invoiced = new Map<string, ReturnType<typeof D>>();
  for (const i of invoices) invoiced.set(i.orderId, (invoiced.get(i.orderId) ?? D(0)).add(i.totalBdt));
  let balance = D(0);
  for (const [orderId, total] of invoiced) {
    const paid = sum(payments.filter((p) => p.orderId === orderId).map((p) => (p.type === "REFUND" ? D(p.amountBdt).neg() : p.amountBdt)));
    if (total.gt(paid)) balance = balance.add(total.sub(paid));
  }
  return { withChina, sampling, quotationsToReview, quoted, upfrontRequested, priceApprovals, openIssues, balanceToCollect: balance, invoicesOpen: invoiced.size };
}

/** BD warehouse view: what is coming, what is in Bangladesh, what is waiting to go out. */
export async function warehouseDashboard() {
  const [onTheWay, arrived, orders, shipping] = await Promise.all([
    prisma.shipment.count({ where: { status: { in: ["DEPARTED", "IN_TRANSIT"] } } }),
    prisma.shipment.count({ where: { status: { in: ["ARRIVED_BD", "CUSTOMS_CLEARED"] } } }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["IN_TRANSIT", "ARRIVED_BD", "CUSTOMS_CLEARED", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"] } } }),
    prisma.shippingOrder.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["IN_SHIPMENT", "RECEIVED_BD", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY"] } } }),
  ]);
  const o = new Map(orders.map((r) => [r.status, r._count._all]));
  const s = new Map(shipping.map((r) => [r.status, r._count._all]));
  return {
    onTheWay,
    arrived,
    ordersInTransit: o.get("IN_TRANSIT") ?? 0,
    ordersReceived: o.get("ARRIVED_BD") ?? 0,
    ordersCustoms: o.get("CUSTOMS_CLEARED") ?? 0,
    ordersReady: o.get("READY_FOR_DELIVERY") ?? 0,
    ordersOut: o.get("OUT_FOR_DELIVERY") ?? 0,
    shippingToReceive: s.get("IN_SHIPMENT") ?? 0,
    shippingReady: s.get("READY_FOR_DELIVERY") ?? 0,
    shippingOut: s.get("OUT_FOR_DELIVERY") ?? 0,
  };
}

/** China (purchase team) view. */
export async function chinaDashboard(now = new Date()) {
  const day = today(CN_TZ, now);
  const [queue, toPrice, awaiting, readyToShip, shipments, openIssues, qaToDo] = await Promise.all([
    purchaseQueue(),
    prisma.order.count({ where: { requestStatus: "NEW", status: { not: "ON_HOLD" } } }),
    prisma.supplierOrder.findMany({ where: { status: { in: ["PURCHASED", "SHIPPED_BY_SUPPLIER"] } }, select: { expectedArrivalAt: true } }),
    prisma.receiving.count({ where: { status: "READY_TO_SHIP" } }),
    acceptingShipments(undefined, now),
    prisma.issue.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, source: "CHINA_RECEIVING" } }),
    qaTodo().then((l) => l.length),
  ]);
  const ordersIn = (pred: (l: (typeof queue)[number]) => boolean) => new Set(queue.filter(pred).map((l) => l.order.id)).size;
  return {
    toPrice,
    readyToBuy: ordersIn((l) => l.advancePaid),
    needPaymentRequest: ordersIn((l) => !l.advancePaid && !l.order.advanceRequestedAt),
    waitingForPayment: ordersIn((l) => !l.advancePaid && !!l.order.advanceRequestedAt),
    awaitingArrival: awaiting.length,
    lateArrivals: awaiting.filter((a) => a.expectedArrivalAt && a.expectedArrivalAt < day).length,
    readyToShip,
    openIssues,
    qaToDo,
    shipments,
  };
}

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

function avg(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Management view: revenue, estimated profit, lead times. Admin only. */
export async function managementDashboard(now = new Date()) {
  const day = today(BD_TZ, now);
  const { year, week } = isoWeek(day);
  const weekStart = isoWeekStart(year, week);
  const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  // Dates are BD calendar days at UTC midnight; shift to Dhaka midnight (UTC+6) for timestamp comparisons.
  const toInstant = (d: Date) => new Date(d.getTime() - 6 * 3_600_000);

  // Revenue = selling price of orders approved by the customer in the period (customer-approved date from audit log).
  const approvals = await prisma.auditLog.findMany({
    where: { entityType: "Order", field: "requestStatus", newValue: { equals: "CUSTOMER_APPROVED" }, createdAt: { gte: toInstant(addDays(monthStart, -400)) } },
    select: { entityId: true, createdAt: true },
  });
  const approvedAt = new Map(approvals.map((a) => [a.entityId, a.createdAt]));

  const orders = await prisma.order.findMany({
    where: { id: { in: [...approvedAt.keys()] }, status: { not: "CANCELLED" } },
    select: {
      id: true,
      number: true,
      customer: { select: { code: true } },
      lines: {
        where: { status: { not: "CANCELLED" } },
        select: {
          sellingPriceBdt: true,
          purchaseLines: { where: { supplierOrder: { status: { notIn: ["OUT_OF_STOCK", "PRICE_CHANGED", "REFUND_FROM_SUPPLIER", "PENDING"] } } }, select: { totalBdt: true } },
          receivingLines: { where: { receiving: { status: { not: "REPACKED" } } }, select: { freightShareBdt: true, receiving: { select: { shipmentId: true } } } },
        },
      },
    },
  });

  const perOrder = orders.map((o) => {
    const revenue = sum(o.lines.map((l) => l.sellingPriceBdt));
    const chinaCost = sum(o.lines.flatMap((l) => l.purchaseLines.map((p) => p.totalBdt)));
    const freight = sum(o.lines.flatMap((l) => l.receivingLines.map((r) => r.freightShareBdt)));
    const bought = o.lines.some((l) => l.purchaseLines.length > 0);
    return { id: o.id, number: o.number, customer: o.customer.code, approvedAt: approvedAt.get(o.id)!, revenue, chinaCost, freight, profit: bought ? revenue.sub(chinaCost).sub(freight) : null };
  });

  const inPeriod = (from: Date) => perOrder.filter((o) => o.approvedAt >= toInstant(from));
  const period = (from: Date) => {
    const os = inPeriod(from);
    return { orders: os.length, revenue: sum(os.map((o) => o.revenue)), profit: sum(os.map((o) => o.profit)) };
  };

  // Profit by shipment: revenue/cost of the lines inside each shipment.
  const shipments = await prisma.shipment.findMany({
    where: { itemCount: { gt: 0 } },
    orderBy: [{ year: "desc" }, { weekNumber: "desc" }],
    take: 8,
    select: {
      id: true,
      code: true,
      status: true,
      freightCostBdt: true,
      receivings: {
        where: { status: { not: "REPACKED" } },
        select: { lines: { select: { quantityReceived: true, purchaseLine: { select: { totalBdt: true, quantity: true } }, orderLine: { select: { sellingPriceBdt: true, quantity: true } } } } },
      },
    },
  });
  const byShipment = shipments.map((s) => {
    const lines = s.receivings.flatMap((r) => r.lines);
    // Pro-rate line values by the quantity in this shipment.
    const revenue = sum(lines.map((l) => (l.orderLine.sellingPriceBdt ? D(l.orderLine.sellingPriceBdt).mul(l.quantityReceived).div(l.orderLine.quantity) : 0)));
    const chinaCost = sum(lines.map((l) => (l.purchaseLine ? D(l.purchaseLine.totalBdt).mul(l.quantityReceived).div(l.purchaseLine.quantity) : 0)));
    const freight = D(s.freightCostBdt);
    return { id: s.id, code: s.code, status: s.status, revenue, chinaCost, freight, profit: revenue.sub(chinaCost).sub(freight), freightKnown: !!s.freightCostBdt };
  });

  // Lead times (days).
  const [received, shipped, approvedToBought] = await Promise.all([
    prisma.receiving.findMany({ where: { supplierOrder: { isNot: null }, status: { not: "REPACKED" } }, select: { receivedAt: true, supplierOrder: { select: { purchaseDate: true } } }, take: 500, orderBy: { receivedAt: "desc" } }),
    prisma.shipment.findMany({ where: { departedAt: { not: null }, arrivedAt: { not: null } }, select: { departedAt: true, arrivedAt: true }, take: 100, orderBy: { arrivedAt: "desc" } }),
    prisma.supplierOrder.findMany({
      where: { status: { notIn: ["PENDING"] } },
      select: { purchaseDate: true, lines: { select: { orderLine: { select: { orderId: true } } } } },
      take: 500,
      orderBy: { purchaseDate: "desc" },
    }),
  ]);
  const leadTimes = {
    approvalToPurchase: avg(
      approvedToBought.flatMap((s) => {
        const t = approvedAt.get(s.lines[0]?.orderLine.orderId ?? "");
        return t ? [daysBetween(t, s.purchaseDate)] : [];
      }),
    ),
    supplierToChina: avg(received.map((r) => daysBetween(r.supplierOrder!.purchaseDate, r.receivedAt))),
    chinaToBd: avg(shipped.map((s) => daysBetween(s.departedAt!, s.arrivedAt!))),
    bdToCustomer: null as number | null, // Delivery module not built yet.
  };

  return {
    week: { label: `Week ${week}`, ...period(weekStart) },
    month: { label: new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(monthStart), ...period(monthStart) },
    recentOrders: [...perOrder].sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime()).slice(0, 10),
    byShipment,
    leadTimes,
  };
}

export type InboxItem = { id: string; no: string; customer: string | null; at: Date; href: string; tag?: string };
export type InboxPanel = { key: "buy" | "ship" | "payments" | "issues"; title: string; hint: string; href: string; count: number; items: InboxItem[] };

const INBOX_LATEST = 5;
const OPEN_ISSUE = ["OPEN", "IN_PROGRESS"] as const;

/**
 * Admin's "New Requests" panels: what came in and nobody has actioned yet.
 * Each item drops out once actioned (quoted by China, received in China,
 * payment approved/rejected, issue resolved/closed).
 */
export async function adminInbox(actor: Actor): Promise<InboxPanel[]> {
  assertCan(actor.role, "dashboard:adminInbox");
  const shipWhere = { status: "REQUESTED" as const };
  const payWhere = { status: "PENDING" as const };
  const issueWhere = { status: { in: [...OPEN_ISSUE] } };
  const take = INBOX_LATEST;
  const customer = { select: { name: true } };
  const [buyCount, buy, shipCount, ship, payCount, pay, issueCount, issues] = await Promise.all([
    prisma.order.count({ where: awaitingQuoteWhere }),
    prisma.order.findMany({ where: awaitingQuoteWhere, orderBy: { requestedAt: "desc" }, take, select: { id: true, number: true, requestedAt: true, source: true, placedByAccount: { select: { kind: true } }, customer } }),
    prisma.shippingOrder.count({ where: shipWhere }),
    prisma.shippingOrder.findMany({ where: shipWhere, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, createdAt: true, source: true, placedByAccount: { select: { kind: true } }, customer } }),
    prisma.paymentSubmission.count({ where: payWhere }),
    prisma.paymentSubmission.findMany({ where: payWhere, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, createdAt: true, customer } }),
    prisma.issue.count({ where: issueWhere }),
    prisma.issue.findMany({ where: issueWhere, orderBy: { createdAt: "desc" }, take, select: { id: true, number: true, createdAt: true, type: true, order: { select: { customer } } } }),
  ]);
  const via = (r: { source: string; placedByAccount: { kind: string } | null }) => (r.placedByAccount?.kind === "AGENT" ? "Agent" : r.source === "PORTAL" ? "Portal" : "Staff");
  return [
    {
      key: "buy",
      title: "Buy for Me",
      hint: "waiting for China's quotation",
      href: "/requests?rs=AWAITING_QUOTE",
      count: buyCount,
      items: buy.map((o) => ({ id: o.id, no: docNo("order", o.number), customer: o.customer.name, at: o.requestedAt, href: `/requests/${o.id}`, tag: via(o) })),
    },
    {
      key: "ship",
      title: "Ship for Me",
      hint: "goods not received in China yet",
      href: "/shipping-orders?status=REQUESTED",
      count: shipCount,
      items: ship.map((s) => ({ id: s.id, no: docNo("shippingOrder", s.number), customer: s.customer.name, at: s.createdAt, href: `/shipping-orders/${s.id}`, tag: via(s) })),
    },
    {
      key: "payments",
      title: "Payment Confirmation",
      hint: "reported by customers, to confirm",
      href: "/payments-to-verify",
      count: payCount,
      items: pay.map((p) => ({ id: p.id, no: submissionNo(p), customer: p.customer.name, at: p.createdAt, href: `/payments-to-verify?id=${p.id}` })),
    },
    {
      key: "issues",
      title: "Issues",
      hint: "open or in progress",
      href: "/issues",
      count: issueCount,
      items: issues.map((i) => ({ id: i.id, no: docNo("issue", i.number), customer: i.order?.customer.name ?? null, at: i.createdAt, href: `/issues?id=${i.id}`, tag: i.type })),
    },
  ];
}
