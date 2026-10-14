import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { readAttachment } from "@/lib/uploads";
import { createPaymentAccount, saveOrganization } from "@/server/organization";
import { assignShippingOrder, createShippingOrder, invoiceShipping, receiveShippingBd, receiveShippingChina, recordShippingPayment } from "@/server/shipping-orders";
import { setShipmentStatus } from "@/server/shipments";
import { createRequest, recordPayment } from "@/server/requests";
import { generateQuotePdf, generateShippingInvoice, latestDocument } from "@/server/documents";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";
import { pdfText, squash } from "../pdf-text";

let admin: Actor, cs: Actor, china: Actor;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000001249444154789c63907358ff1f1933a00b00000a491061fb654d210000000049454e44ae426082", "hex");

const textOf = async (storageKey: string) => pdfText(await readAttachment(storageKey));

async function invoicedShippingOrder() {
  const so = await createShippingOrder(cs, { customer: { name: "Rahim Uddin", phone: "01711000000", address: "Road 5, Mirpur" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Sneakers", quantity: 3 }] });
  const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
  await receiveShippingChina(china, so.id, { items: [{ itemId: item.id, quantityReceived: 3, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "12.5" }] });
  const { shipment } = await assignShippingOrder(china, so.id, "auto");
  for (const st of ["CLOSED", "DEPARTED", "ARRIVED_BD"] as const) await setShipmentStatus(admin, shipment.id, st);
  await receiveShippingBd(cs, so.id);
  // 12.5 kg × 800 = 10,000 + delivery 120 − discount 20 = 10,100
  await invoiceShipping(admin, so.id, { ratePerUnitBdt: "800", localDeliveryBdt: "120", discountBdt: "20", notes: "Thank you for shipping with us", dueDate: new Date("2099-01-10T00:00:00Z") });
  return { so, shipment };
}

describe("Generated PDFs", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
    await saveOrganization(admin, { name: "Acme Sourcing BD", tagline: "", phone: "01999000000", email: "billing@acme.test", website: "www.acme.test", address: "Gulshan Avenue, Dhaka" }, { logo: new File([new Uint8Array(PNG)], "logo.png", { type: "image/png" }) });
    await createPaymentAccount(admin, { type: "BANK", providerName: "City Bank", accountName: "Acme Sourcing BD", accountNumber: "ACC-778899", branch: "Banani", routingNumber: "225260437", showOnPdf: true });
    await createPaymentAccount(admin, { type: "MOBILE_BANKING", providerName: "Hidden Pay", accountName: "Acme", accountNumber: "HIDDEN-0001", showOnPdf: false });
  });

  it("saving a Ship for Me invoice makes a PDF from Settings; revising and paying make new versions", async () => {
    const { so, shipment } = await invoicedShippingOrder();
    const v1 = (await latestDocument("SHIPPING_INVOICE", { shippingOrderId: so.id }))!;
    expect(v1).toMatchObject({ version: 1, number: "INV-SHO-000001", fileName: "INV-SHO-000001.pdf" });
    const pdf = await readAttachment(v1.storageKey);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.includes(Buffer.from("/Subtype /Image"))).toBe(true); // the logo is embedded

    const t = await textOf(v1.storageKey);
    for (const want of ["INVOICE", "INV-SHO-000001", "AcmeSourcingBD", "GulshanAvenue,Dhaka", "billing@acme.test", "RahimUddin", "01711000000", shipment.code, "SHO-000001", "10Jan2099", "Airfreight", "12.5kg", "BDT800.00", "BDT10,000.00", "Homedelivery", "Discount", "-BDT20.00", "BDT10,100.00", "Balancedue", "CityBank", "ACC-778899", "225260437", "INV-SHO-000001asthepaymentreference", "Thankyouforshippingwithus"]) {
      expect(t, want).toContain(squash(want));
    }
    expect(t).not.toContain("HIDDEN-0001"); // account not marked "Show on PDFs"

    // Revise: the PDF is regenerated with the new total.
    await invoiceShipping(admin, so.id, { ratePerUnitBdt: "900", localDeliveryBdt: "120", discountBdt: "20" });
    const v2 = (await latestDocument("SHIPPING_INVOICE", { shippingOrderId: so.id }))!;
    expect(v2.version).toBe(2);
    expect(await textOf(v2.storageKey)).toContain(squash("BDT 11,350.00"));

    // A payment: a receipt, and the invoice is regenerated with the amount paid.
    await recordShippingPayment(cs, so.id, { amountBdt: "5000", method: "BKASH", reference: "TRX998877" });
    const pay = await prisma.payment.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    const receipt = (await latestDocument("PAYMENT_RECEIPT", { paymentId: pay.id }))!;
    const r = await textOf(receipt.storageKey);
    for (const want of ["PAYMENT RECEIVED", `RCT-${String(pay.number).padStart(6, "0")}`, "BDT 5,000.00", "bKash", "TRX998877", "AcmeSourcingBD", "Balance due", "BDT 6,350.00"]) expect(r, want).toContain(squash(want));
    const v3 = (await latestDocument("SHIPPING_INVOICE", { shippingOrderId: so.id }))!;
    expect(v3.version).toBe(3);
    expect(await textOf(v3.storageKey)).toContain(squash("Amount paid"));
    expect(await textOf(v3.storageKey)).toContain(squash("BDT 6,350.00"));
  });

  it("Buy for Me payments get a receipt; quotations use the same templates", async () => {
    const { order } = await createRequest(cs, { customer: { name: "Karim", phone: "01822000000", address: "Uttara" }, shippingMethod: "AIR", lines: [{ productName: "Desk lamp", quantity: 2, links: [] }] });
    const e = await quoteAndApprove(order.id, "10", "1500");
    const quote = (await latestDocument("QUOTE", { estimateId: e.id }))!; // made when the quote was sent
    const q = await textOf(quote.storageKey);
    for (const want of ["QUOTATION", "AcmeSourcingBD", "Desklamp", "BDT1,500.00", "CityBank", "REQ-000001"]) expect(q, want).toContain(squash(want));
    expect((await generateQuotePdf(e.id, admin.id))!.version).toBe(2);

    await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "750", method: "NAGAD", reference: "NG123" });
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const r = await textOf((await latestDocument("PAYMENT_RECEIPT", { paymentId: pay.id }))!.storageKey);
    for (const want of ["PAYMENT RECEIVED", "BDT 750.00", "advance payment for REQ-000001", "Karim"]) expect(r, want).toContain(squash(want));
  });

  it("no invoice yet → no PDF", async () => {
    const so = await createShippingOrder(cs, { customer: { name: "R", phone: "01733000000", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Box", quantity: 1 }] });
    expect(await generateShippingInvoice(so.id, admin.id)).toBeNull();
  });
});
