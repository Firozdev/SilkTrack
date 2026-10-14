import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { readAttachment } from "@/lib/uploads";
import { createPaymentAccount, saveOrganization } from "@/server/organization";
import { acceptInvite, accountForSession, approveAccount, createSession, signUp } from "@/server/portal-auth";
import { assignAgent, createAgent } from "@/server/agents";
import { ownerOf, type PortalLogin } from "@/server/portal-access";
import { assignShippingOrder, createShippingOrder, invoiceShipping, receiveShippingBd, receiveShippingChina } from "@/server/shipping-orders";
import { setShipmentStatus } from "@/server/shipments";
import { latestDocument } from "@/server/documents";
import { createVersion, getVersion, listVersions, prefillVersion, updateVersion, versionPdf } from "@/server/custom-invoices";
import type { Actor } from "@/server/actor";
import { makeRate, makeUser, resetDb } from "../helpers";
import { pdfText, squash } from "../pdf-text";

let admin: Actor, cs: Actor, china: Actor;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000001249444154789c63907358ff1f1933a00b00000a491061fb654d210000000049454e44ae426082", "hex");
const png = (name = "my-logo.png") => new File([new Uint8Array(PNG)], name, { type: "image/png" });

async function customerLogin(phone: string): Promise<PortalLogin> {
  const acc = await signUp({ name: "Karim Traders", phone, password: "secret-pass-1", address: "Mirpur" });
  await approveAccount(cs, acc.id, "new");
  const { token } = await createSession(acc.id);
  return (await accountForSession(token))!;
}

/** Received in Bangladesh and invoiced: 12.5 kg × 800 + delivery 120 − 20 = 10,100. */
async function invoiced(customerId: string) {
  const so = await createShippingOrder(cs, { customer: { id: customerId, name: "x", phone: "x", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Sneakers", quantity: 3 }] });
  const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
  await receiveShippingChina(china, so.id, { items: [{ itemId: item.id, quantityReceived: 3, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "12.5" }] });
  const { shipment } = await assignShippingOrder(china, so.id, "auto");
  for (const st of ["CLOSED", "DEPARTED", "ARRIVED_BD"] as const) await setShipmentStatus(admin, shipment.id, st);
  await receiveShippingBd(cs, so.id);
  await invoiceShipping(admin, so.id, { ratePerUnitBdt: "800", localDeliveryBdt: "120", discountBdt: "20" });
  return so;
}

describe("Customer portal – invoice PDF and my own versions", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
    await saveOrganization(admin, { name: "Acme Sourcing BD", tagline: "", phone: "01999000000", email: "billing@acme.test", website: "", address: "Gulshan Avenue" });
    await createPaymentAccount(admin, { type: "BANK", providerName: "City Bank", accountName: "Acme Sourcing BD", accountNumber: "ACC-778899", showOnPdf: true });
  });

  it("a version is a separate, editable copy with their own branding – our invoice never changes", async () => {
    const k = await customerLogin("01711000000");
    const so = await invoiced(k.customer!.id);

    // The customer can get our original invoice (the same file staff download).
    expect(await ownerOf(k, "shipping", so.id)).toBe(k.customer!.id);
    const ours = (await latestDocument("SHIPPING_INVOICE", { shippingOrderId: so.id }))!;
    const oursBytes = await readAttachment(ours.storageKey);
    const before = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } });
    const docsBefore = await prisma.generatedDocument.count();

    // Pre-filled from our invoice
    const start = await prefillVersion(k, so.id);
    expect(start.items).toEqual([expect.objectContaining({ qty: "12.5", unitPrice: "800.00", description: expect.stringContaining("(per kg)") })]);
    expect(start.charges).toEqual([{ label: "Home delivery in Bangladesh", amount: "120.00" }]);
    expect(start.discount).toBe("20.00");

    // Their own business, customer, prices, charges and accounts
    const v = await createVersion(
      k,
      so.id,
      {
        ...start,
        label: "For Rahim",
        business: { name: "Karim Traders", phone: "01711000000", email: "karim@traders.test", address: "Shop 4, Mirpur 10" },
        invoiceNo: "KT-2026-001",
        billTo: { name: "Rahim Uddin", phone: "01822000000", address: "Uttara" },
        items: [
          { description: "Sneakers imported", qty: "3", unitPrice: "4500" },
          { description: "Packing", qty: "1", unitPrice: "300" },
        ],
        charges: [{ label: "Delivery to your door", amount: "200" }],
        discount: "500",
        paid: "1000",
        notes: "Thanks for your order",
        accounts: [{ provider: "bKash", accountName: "Karim Traders", accountNumber: "01711-999999", notes: "Send money" }],
      },
      png(),
    );
    const t = pdfText((await versionPdf(k, v.id))!.pdf);
    // 3 × 4500 + 300 + 200 − 500 = 13,500; − 1,000 paid = 12,500
    for (const want of ["INVOICE", "KT-2026-001", "Karim Traders", "Shop 4, Mirpur 10", "Rahim Uddin", "Sneakers imported", "BDT 4,500.00", "BDT 13,500.00", "Delivery to your door", "-BDT 500.00", "BDT 12,500.00", "01711-999999", "Thanks for your order"]) expect(t, want).toContain(squash(want));
    for (const ourText of ["Acme Sourcing BD", "ACC-778899", "City Bank", "billing@acme.test", "INV-SHO"]) expect(t, ourText).not.toContain(squash(ourText)); // none of our branding
    expect((await versionPdf(k, v.id))!.pdf.includes(Buffer.from("/Subtype /Image"))).toBe(true); // their logo

    // Edit it again later; and keep more than one version
    await updateVersion(k, v.id, { ...(await getVersion(k, v.id))!.data, discount: "0" }, {});
    const edited = pdfText((await versionPdf(k, v.id))!.pdf);
    expect(edited).toContain(squash("BDT 14,000.00")); // no discount any more
    expect(edited).toContain(squash("BDT 13,000.00")); // − 1,000 paid
    await createVersion(k, so.id, { ...start, label: "Plain copy" });
    expect((await listVersions(k, so.id)).map((x) => x.label)).toEqual(["For Rahim", "Plain copy"]);

    // Our invoice and records are untouched.
    const after = await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } });
    expect(after).toEqual(before);
    expect(await prisma.generatedDocument.count()).toBe(docsBefore);
    expect((await readAttachment(ours.storageKey)).equals(oursBytes)).toBe(true);
    expect((await latestDocument("SHIPPING_INVOICE", { shippingOrderId: so.id }))!.id).toBe(ours.id);
  });

  it("server re-checks: owner only, totals and inputs validated", async () => {
    const k = await customerLogin("01711000000");
    const other = await customerLogin("01722000000");
    const so = await invoiced(k.customer!.id);
    const start = await prefillVersion(k, so.id);
    const v = await createVersion(k, so.id, start);

    await expect(prefillVersion(other, so.id)).rejects.toThrow(/Not found/);
    await expect(createVersion(other, so.id, start)).rejects.toThrow(/Not found/);
    expect(await getVersion(other, v.id)).toBeNull();
    expect(await versionPdf(other, v.id)).toBeNull();
    await expect(updateVersion(other, v.id, start)).rejects.toThrow(/Not found/);

    // Their agent can make their own versions, but the two never see each other's.
    const { token, account } = await createAgent(admin, { name: "Rafiq", phone: "01911000000" });
    await acceptInvite(token, "agent-pass-123");
    await assignAgent(admin, k.customer!.id, account.id);
    const agent = (await accountForSession((await createSession(account.id)).token))!;
    const av = await createVersion(agent, so.id, { ...start, label: "Agent copy" });
    expect(await getVersion(agent, v.id)).toBeNull();
    expect(await getVersion(k, av.id)).toBeNull();
    expect((await listVersions(k, so.id)).map((x) => x.label)).toEqual([start.label]);

    await expect(createVersion(k, so.id, { ...start, discount: "999999" })).rejects.toThrow(/discount/);
    await expect(createVersion(k, so.id, { ...start, items: [] })).rejects.toThrow(/at least one line/);
    await expect(createVersion(k, so.id, { ...start, items: [{ description: "x", qty: "1", unitPrice: "-5" }] })).rejects.toThrow(/amount/);
    await expect(createVersion(k, so.id, start, new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], "l.svg", { type: "image/svg+xml" }))).rejects.toThrow(/PNG or JPG/);

    // At most 10 versions per order (k already has 1)
    for (let n = 2; n <= 10; n++) await createVersion(k, so.id, { ...start, label: `V${n}` });
    await expect(createVersion(k, so.id, { ...start, label: "V11" })).rejects.toThrow(/up to 10 versions/);
    expect(await createVersion(agent, so.id, { ...start, label: "Agent 2" })).toBeTruthy(); // the agent's own count is separate

    // An empty account name isn't printed as a bare label
    const plain = await createVersion(agent, so.id, { ...start, label: "No name", accounts: [{ provider: "Nagad", accountName: "", accountNumber: "01800-111111", notes: "" }] });
    const pt = pdfText((await versionPdf(agent, plain.id))!.pdf);
    expect(pt).toContain(squash("Account no.: 01800-111111"));
    expect(pt).not.toContain(squash("Account name:"));

    // No invoice yet → nothing to copy
    const fresh = await createShippingOrder(cs, { customer: { id: k.customer!.id, name: "x", phone: "x", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Box", quantity: 1 }] });
    await expect(prefillVersion(k, fresh.id)).rejects.toThrow(/no invoice yet/);
  });
});
