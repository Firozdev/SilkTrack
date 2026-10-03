import "server-only";
import { prisma } from "@/lib/prisma";
import { redactFor, type Viewer } from "@/lib/permissions";

const att = { select: { id: true, fileName: true, mimeType: true } } as const;

/** Everything shown on the order page, redacted for the viewer's role. */
export async function getOrderView(orderId: string, viewer: Viewer) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      createdBy: { select: { name: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          links: true,
          attachments: att,
          purchaseLines: { include: { supplierOrder: { select: { id: true, number: true, status: true, trackingNo: true, courierName: true, expectedArrivalAt: true } } } },
          receivingLines: { include: { receiving: { select: { id: true, number: true, receivedAt: true, condition: true, shipment: { select: { id: true, code: true, status: true, etaBd: true } } } } } },
          trackingEvents: { orderBy: { occurredAt: "asc" }, include: { createdBy: { select: { name: true } } } },
        },
      },
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, role: true } }, attachments: att } },
      payments: { orderBy: { paidAt: "asc" }, include: { receivedBy: { select: { name: true } } } },
      estimates: { orderBy: { version: "desc" }, select: { id: true, number: true, version: true, status: true, validUntil: true, grandTotalBdt: true, totalRmb: true } },
      samples: { orderBy: { requestedAt: "desc" }, include: { lines: true } },
      invoices: { orderBy: { createdAt: "desc" } },
      deliveries: { orderBy: { createdAt: "desc" }, include: { attachments: att } },
      issues: { orderBy: { createdAt: "desc" } },
      claims: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return null;
  return redactFor(viewer, order);
}

export type OrderView = NonNullable<Awaited<ReturnType<typeof getOrderView>>>;
