import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { BD_TZ, addDays, toYmd, today } from "@/lib/dates";
import { approveAccount, signUp } from "@/server/portal-auth";
import { createPortalRequest } from "@/server/requests";
import { reviseQuotation, saveQuotation, sendQuotationToCustomer, setSellingPrices, submitQuotation, type QuotationInput } from "@/server/estimates";
import { addQuoteImages, removeQuoteImages } from "@/server/quote-images";
import { portalAttachment, portalOrder } from "@/server/portal";
import { generateQuotePdf } from "@/server/documents";
import { readAttachment } from "@/lib/uploads";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000001249444154789c63907358ff1f1933a00b00000a491061fb654d210000000049454e44ae426082", "hex");
const png = (name = "lamp.png") => new File([new Uint8Array(PNG)], name, { type: "image/png" });

async function customer(phone: string) {
  const acc = await signUp({ name: "Karim", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  return { accountId: acc.id, customerId: (await prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } })).customerId! };
}

const input = (lines: { id: string }[]): QuotationInput => ({
  shippingMethod: "AIR",
  shippingRatePerKgRmb: "10",
  validUntil: addDays(today(BD_TZ), 7),
  lines: lines.map((l) => ({ orderLineId: l.id, unitPriceRmb: "10", unitWeightKg: "0.5" })),
});

describe("China quotation – product images per line", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("China adds images per line on the draft; customer sees them only once the quote is sent; in the PDF; kept on revision", async () => {
    const k = await customer("01711000000");
    const cid = k.customerId;
    const { order } = await createPortalRequest(cid, { shippingMethod: "AIR", lines: [{ productName: "Lamp", quantity: 2, links: [] }, { productName: "Bag", quantity: 1, links: [] }] }, { accountId: k.accountId });
    const [lamp, bag] = order.lines;
    const e = await saveQuotation(china, order.id, input(order.lines));

    // Only China / Admin; images only (checked by content); only products of this order
    await expect(addQuoteImages(cs, e.id, { [lamp.id]: [png()] })).rejects.toThrow(ForbiddenError);
    await expect(addQuoteImages(china, e.id, { [lamp.id]: [new File(["%PDF-1.4"], "x.png", { type: "image/png" })] })).rejects.toThrow(/only JPG, PNG or WebP/);
    await expect(addQuoteImages(china, e.id, { [lamp.id]: [new File(["GIF89a"], "x.gif", { type: "image/gif" })] })).rejects.toThrow(/only JPG, PNG or WebP/);
    await expect(addQuoteImages(china, e.id, { nope: [png()] })).rejects.toThrow(/not on this quotation/);
    await addQuoteImages(china, e.id, { [lamp.id]: [png("lamp-1.png"), png("lamp-2.png")], [bag.id]: [] });

    // Saving the draft again (lines are recreated) keeps the images; China can remove one
    await saveQuotation(china, order.id, input(order.lines));
    let imgs = await prisma.attachment.findMany({ where: { estimateId: e.id }, orderBy: { fileName: "asc" } });
    expect(imgs.map((a) => [a.kind, a.fileName, a.estimateOrderLineId])).toEqual([
      ["QUOTE_IMAGE", "lamp-1.png", lamp.id],
      ["QUOTE_IMAGE", "lamp-2.png", lamp.id],
    ]);
    await removeQuoteImages(china, e.id, [imgs[1].id]);
    imgs = await prisma.attachment.findMany({ where: { estimateId: e.id } });
    expect(imgs.map((a) => a.fileName)).toEqual(["lamp-1.png"]);

    // Not visible to the customer while it's with China / Bangladesh
    await submitQuotation(china, e.id);
    await expect(addQuoteImages(china, e.id, { [lamp.id]: [png()] })).rejects.toThrow(/revise it to change images/);
    expect(await portalAttachment([cid], imgs[0].id)).toBeNull();
    expect((await portalOrder(cid, order.id))!.quote).toBeNull();

    // Sent: the customer sees it on the quote and can open it – another customer can't
    const lines = await prisma.estimateLine.findMany({ where: { estimateId: e.id } });
    await setSellingPrices(cs, e.id, lines.map((l) => ({ lineId: l.id, sellingPriceBdt: "1000" })));
    await sendQuotationToCustomer(cs, e.id);
    const q = (await portalOrder(cid, order.id))!.quote!;
    expect(q.attachments.map((a) => [a.fileName, a.estimateOrderLineId])).toEqual([["lamp-1.png", lamp.id]]);
    expect(await portalAttachment([cid], imgs[0].id)).toMatchObject({ fileName: "lamp-1.png" });
    expect(await portalAttachment([(await customer("01722000000")).customerId], imgs[0].id)).toBeNull();

    // In the quote PDF (no logo is set up in this test, so any image is the product's)
    const doc = (await generateQuotePdf(e.id, cs.id))!;
    const pdf = await readAttachment(doc.storageKey);
    expect(pdf.includes(Buffer.from("/Subtype /Image"))).toBe(true);

    // A revision starts with the same images
    const v2 = await reviseQuotation(china, e.id, "new price");
    expect((await prisma.attachment.findMany({ where: { estimateId: v2.id } })).map((a) => [a.fileName, a.estimateOrderLineId, a.storageKey])).toEqual([["lamp-1.png", lamp.id, imgs[0].storageKey]]);
  });
});
