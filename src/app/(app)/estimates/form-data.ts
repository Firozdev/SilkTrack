import "server-only";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BD_TZ, addDays, toYmd, today } from "@/lib/dates";
import { canSeeSelling, type Viewer } from "@/lib/permissions";
import { getCurrentRate } from "@/server/rates";
import { quoteImageSelect } from "@/server/quote-images";
import type { QInitial, QLine } from "./quotation-form";

const s = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : v.toString());

/** Lines and initial values for the quotation form (new or editing the draft). */
export async function quotationFormData(orderId: string, viewer: Viewer) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { code: true } },
      lines: { where: { status: { not: "CANCELLED" } }, orderBy: { lineNo: "asc" }, include: { links: { select: { url: true }, take: 1 } } },
      estimates: { orderBy: { version: "desc" }, take: 1, include: { lines: true, attachments: quoteImageSelect } },
    },
  });
  if (!order) notFound();
  const draft = order.estimates[0]?.status === "DRAFT" ? order.estimates[0] : null;
  const { rate } = await getCurrentRate();
  const selling = canSeeSelling(viewer);

  const lines: QLine[] = order.lines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    productName: l.productName,
    variant: [l.color, l.size, l.model].filter(Boolean).join(" · ") || "no variant",
    quantity: l.quantity,
    link: l.links[0]?.url,
    images: (draft?.attachments ?? []).filter((a) => a.estimateOrderLineId === l.id).map(({ id, fileName }) => ({ id, fileName })),
  }));
  const initial: QInitial = {
    shippingMethod: draft?.shippingMethod ?? order.shippingMethod,
    shippingRatePerKgRmb: s(draft?.shippingRatePerKgRmb),
    shippingRatePerCbmRmb: s(draft?.shippingRatePerCbmRmb),
    domesticShippingRmb: s(draft?.domesticShippingRmb),
    packingRmb: s(draft?.packingRmb),
    inspectionRmb: s(draft?.inspectionRmb),
    serviceFeeRmb: s(draft?.serviceFeeRmb),
    validUntil: toYmd(draft?.validUntil ?? addDays(today(BD_TZ), 7)),
    notes: draft?.notes ?? "",
    lines: Object.fromEntries(
      (draft?.lines ?? []).map((l) => [
        l.orderLineId,
        {
          unitPriceRmb: s(l.unitPriceRmb),
          moq: s(l.moq),
          unitWeightKg: s(l.unitWeightKg),
          cartonCount: l.cartonCount ? String(l.cartonCount) : "",
          lengthCm: s(l.lengthCm),
          widthCm: s(l.widthCm),
          heightCm: s(l.heightCm),
          // The form takes the price per unit; stored as the line total.
          sellingUnitBdt: selling && l.sellingPriceBdt && l.quantity > 0 ? l.sellingPriceBdt.div(l.quantity).toDecimalPlaces(2).toString() : "",
        },
      ]),
    ),
  };
  return { order, draft, lines, initial, canSetSelling: selling, rate: rate ? rate.rate.toString() : null };
}
