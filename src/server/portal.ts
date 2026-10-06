import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { D, sum, type Decimal } from "@/lib/money";
import { customerLedger } from "./ledger";

/**
 * Customer portal reads. Every query is scoped to the signed-in customer and
 * uses an explicit `select` of customer-safe fields: no RMB cost, exchange
 * rates, margin, internal comments, China notes or staff names. Timelines show
 * status + date only (internal event messages can mention costs).
 */

/**
 * Files a customer may see on their own records: product photos, warehouse /
 * QA photos, proof of delivery and their own uploads. Never supplier invoices
 * from our purchases, internal comment files, issues or claims.
 */
const VISIBLE_FILE: Prisma.AttachmentWhereInput = { kind: { not: "SUPPLIER_INVOICE" }, commentId: null, issueId: null, claimId: null, supplierOrderId: null, receivingId: null };
const fileSelect = { where: VISIBLE_FILE, orderBy: { createdAt: "asc" as const }, select: { id: true, fileName: true, mimeType: true, uploadedByAccountId: true } };

/** The attachment if this customer may download it, else null. */
export function portalAttachment(customerId: string, id: string) {
  return prisma.attachment.findFirst({
    where: {
      id,
      ...VISIBLE_FILE,
      OR: [{ shippingOrder: { customerId } }, { order: { customerId } }, { orderLine: { order: { customerId } } }, { sample: { customerId } }, { delivery: { order: { customerId } } }],
    },
    select: { storageKey: true, mimeType: true, fileName: true },
  });
}

const paidOf = (rows: { type: string; amountBdt: Decimal }[]) => sum(rows.map((p) => (p.type === "REFUND" ? D(p.amountBdt).neg() : D(p.amountBdt))));

export async function portalDashboard(customerId: string) {
  const [orders, shipping, samples, ledger] = await Promise.all([
    prisma.order.findMany({
      where: { customerId },
      orderBy: { requestedAt: "desc" },
      take: 100,
      select: { id: true, number: true, status: true, requestStatus: true, requestedAt: true, shippingMethod: true, lines: { select: { productName: true, quantity: true }, orderBy: { lineNo: "asc" } } },
    }),
    prisma.shippingOrder.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, number: true, status: true, createdAt: true, shippingMethod: true, invoiceTotalBdt: true, items: { select: { productName: true, quantity: true }, orderBy: { lineNo: "asc" } } },
    }),
    prisma.sample.findMany({
      where: { customerId },
      orderBy: { requestedAt: "desc" },
      take: 100,
      select: { id: true, number: true, status: true, requestedAt: true, lines: { select: { productName: true, quantity: true } } },
    }),
    customerLedger(customerId),
  ]);
  return { orders, shipping, samples, ledger };
}

export async function portalOrder(customerId: string, orderId: string) {
  const o = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      requestStatus: true,
      shippingMethod: true,
      type: true,
      targetBudgetBdt: true,
      customerNotes: true,
      requestedAt: true,
      attachments: fileSelect,
      lines: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          lineNo: true,
          productName: true,
          color: true,
          size: true,
          model: true,
          quantity: true,
          status: true,
          links: { select: { url: true } },
          attachments: fileSelect,
          trackingEvents: {
            where: { status: { not: null } },
            orderBy: { occurredAt: "asc" },
            select: { id: true, leg: true, status: true, occurredAt: true, courier: true, trackingNo: true, shipment: { select: { code: true } } },
          },
        },
      },
      // Only what was actually sent to the customer.
      estimates: {
        where: { status: { in: ["SENT_TO_CUSTOMER", "APPROVED"] } },
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, number: true, version: true, status: true, validUntil: true, sentAt: true, grandTotalBdt: true, lines: { select: { id: true, productName: true, quantity: true, sellingPriceBdt: true } } },
      },
      invoices: {
        where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, status: true, totalBdt: true, advancePaidBdt: true, balanceDueBdt: true, issuedAt: true },
      },
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, type: true, amountBdt: true, method: true, paidAt: true } },
      deliveries: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, courier: true, trackingNo: true, dispatchedAt: true, deliveredAt: true } },
      samples: { select: { id: true, number: true, status: true } },
    },
  });
  if (!o) return null;
  const e = o.estimates[0];
  return { ...o, paid: paidOf(o.payments), quote: e ? { ...e, estimateId: e.id } : null };
}

export async function portalShippingOrder(customerId: string, id: string) {
  const s = await prisma.shippingOrder.findFirst({
    where: { id, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      shippingMethod: true,
      qaRequested: true,
      qaResult: true,
      qaNotes: true,
      customerNotes: true,
      declaredWeightKg: true,
      declaredCbm: true,
      createdAt: true,
      receivedChinaAt: true,
      cartonCount: true,
      grossWeightKg: true,
      cbm: true,
      receivedBdAt: true,
      shipment: { select: { code: true, status: true, etaBd: true, departedAt: true, arrivedAt: true } },
      items: { orderBy: { lineNo: "asc" }, select: { id: true, lineNo: true, productName: true, description: true, quantity: true, courierName: true, trackingNo: true, quantityReceived: true, condition: true } },
      billWeightKg: true,
      billCbm: true,
      shipRatePerKgBdt: true,
      shipRatePerCbmBdt: true,
      shippingChargeBdt: true,
      qaFeeBdt: true,
      localDeliveryBdt: true,
      otherChargeBdt: true,
      discountBdt: true,
      invoiceTotalBdt: true,
      invoicedAt: true,
      deliveryCourier: true,
      deliveryTrackingNo: true,
      dispatchedAt: true,
      deliveredAt: true,
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, type: true, amountBdt: true, method: true, paidAt: true } },
      events: { where: { status: { not: null } }, orderBy: { occurredAt: "asc" }, select: { id: true, status: true, occurredAt: true } },
      attachments: fileSelect,
    },
  });
  if (!s) return null;
  const paid = paidOf(s.payments);
  const balance = D(s.invoiceTotalBdt).sub(paid);
  return { ...s, paid, balance: balance.isNeg() ? D(0) : balance };
}

export async function portalSample(customerId: string, id: string) {
  const s = await prisma.sample.findFirst({
    where: { id, customerId },
    select: {
      id: true,
      number: true,
      status: true,
      requestedAt: true,
      order: { select: { id: true, number: true } },
      lines: { select: { id: true, productName: true, variant: true, quantity: true } },
      totalBdt: true,
      invoicedAt: true,
      shippingMode: true,
      carrierName: true,
      trackingNo: true,
      trackingUrl: true,
      etaBd: true,
      shipment: { select: { code: true } },
      receivedBdAt: true,
      deliveredAt: true,
      payments: { orderBy: { paidAt: "asc" }, select: { id: true, type: true, amountBdt: true, method: true, paidAt: true } },
      events: { where: { status: { not: null } }, orderBy: { occurredAt: "asc" }, select: { id: true, status: true, occurredAt: true } },
      attachments: fileSelect,
    },
  });
  if (!s) return null;
  const paid = paidOf(s.payments);
  const balance = D(s.totalBdt).sub(paid);
  return { ...s, paid, balance: balance.isNeg() ? D(0) : balance };
}
