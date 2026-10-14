import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/permissions";
import { readAttachment } from "@/lib/uploads";
import {
  createPaymentAccount,
  deletePaymentAccount,
  getDocumentBranding,
  getOrganization,
  listPaymentAccounts,
  movePaymentAccount,
  saveOrganization,
  setShowOnPdf,
  updatePaymentAccount,
  type PaymentAccountInput,
} from "@/server/organization";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let admin: Actor, cs: Actor;

const ORG = { name: "SilkTrack Ltd", tagline: "China to your door", phone: "01700000000", email: "hello@silktrack.test", website: "www.silktrack.test", address: "House 1, Road 2\nDhaka" };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000040000000208060000007fa87d630000001249444154789c63907358ff1f1933a00b00000a491061fb654d210000000049454e44ae426082", "hex");
const file = (data: Buffer | string, name: string, type: string) => new File([typeof data === "string" ? data : new Uint8Array(data)], name, { type });
const bank: PaymentAccountInput = { type: "BANK", providerName: "Dutch-Bangla Bank", accountName: "SilkTrack Ltd", accountNumber: "1234567890", branch: "Gulshan", routingNumber: "090261726", showOnPdf: true };

describe("Settings – organization and payment information", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
  });

  it("only Admin saves organization details; they persist", async () => {
    expect(await getOrganization()).toMatchObject({ name: "", logo: null });
    await expect(saveOrganization(cs, ORG)).rejects.toThrow(ForbiddenError);
    await expect(saveOrganization(admin, { ...ORG, name: " " })).rejects.toThrow(/organization name/);
    await expect(saveOrganization(admin, { ...ORG, email: "nope" })).rejects.toThrow(/email/);

    await saveOrganization(admin, ORG);
    expect(await getOrganization()).toEqual({ ...ORG, logo: null });
    const log = await prisma.auditLog.findMany({ where: { entityType: "Setting", entityId: "organization" } });
    expect(log.map((l) => l.field).sort()).toEqual(["address", "email", "name", "phone", "tagline", "website"]);
  });

  it("logo: PNG/JPG/SVG by content, replace and remove; scripts and other files refused", async () => {
    const saved = await saveOrganization(admin, ORG, { logo: file(PNG, "logo.png", "image/png") });
    expect(saved.logo).toMatchObject({ mime: "image/png", fileName: "logo.png" });
    expect((await readAttachment(saved.logo!.key)).equals(PNG)).toBe(true);
    expect((await getDocumentBranding()).logoUrl).toBe(`/api/org/logo?v=${saved.logo!.key}`);

    // Saving other fields keeps the logo; a new file replaces it.
    expect((await saveOrganization(admin, { ...ORG, phone: "01800000000" })).logo?.key).toBe(saved.logo!.key);
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    const replaced = await saveOrganization(admin, ORG, { logo: file(svg, "logo.svg", "image/svg+xml") });
    expect(replaced.logo?.mime).toBe("image/svg+xml");

    await expect(saveOrganization(admin, ORG, { logo: file('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "x.svg", "image/svg+xml") })).rejects.toThrow(/scripts/);
    await expect(saveOrganization(admin, ORG, { logo: file('<svg onload="alert(1)"></svg>', "x.svg", "image/svg+xml") })).rejects.toThrow(/scripts/);
    await expect(saveOrganization(admin, ORG, { logo: file("hello", "logo.png", "image/png") })).rejects.toThrow(/PNG, JPG or SVG/); // named .png, isn't one
    await expect(saveOrganization(admin, ORG, { logo: file(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a0e2bd2b0000000049454e44ae426082", "hex"), "broken.png", "image/png") })).rejects.toThrow(/damaged/);
    await expect(saveOrganization(admin, ORG, { logo: file(Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), "big.png", "image/png") })).rejects.toThrow(/2 MB/);
    expect((await getOrganization()).logo?.key).toBe(replaced.logo!.key); // failed uploads change nothing

    expect((await saveOrganization(admin, ORG, { removeLogo: true })).logo).toBeNull();
    expect((await getDocumentBranding()).logoUrl).toBeNull();
  });

  it("payment accounts: add, edit, show on PDFs, reorder, delete – Admin only", async () => {
    await expect(createPaymentAccount(cs, bank)).rejects.toThrow(ForbiddenError);
    await expect(createPaymentAccount(admin, { ...bank, accountNumber: " " })).rejects.toThrow(/account number/);
    const a = await createPaymentAccount(admin, bank);
    const b = await createPaymentAccount(admin, { type: "MOBILE_BANKING", providerName: "bKash", accountName: "SilkTrack", accountNumber: "01700000000", notes: "Merchant – use Payment", showOnPdf: true });
    const c = await createPaymentAccount(admin, { type: "OTHER", providerName: "Cash office", accountName: "Front desk", accountNumber: "-", showOnPdf: false });
    expect((await listPaymentAccounts()).map((x) => x.providerName)).toEqual(["Dutch-Bangla Bank", "bKash", "Cash office"]);

    // Only accounts marked "Show on PDFs", in order
    expect((await getDocumentBranding()).accounts.map((x) => x.id)).toEqual([a.id, b.id]);
    await movePaymentAccount(admin, b.id, "up");
    expect((await getDocumentBranding()).accounts.map((x) => x.id)).toEqual([b.id, a.id]);
    await movePaymentAccount(admin, b.id, "up"); // already first: no change
    expect((await listPaymentAccounts()).map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    await setShowOnPdf(admin, c.id, true);
    await setShowOnPdf(admin, b.id, false);
    expect((await getDocumentBranding()).accounts.map((x) => x.id)).toEqual([a.id, c.id]);

    await updatePaymentAccount(admin, a.id, { ...bank, branch: "Motijheel" });
    expect((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: a.id } })).branch).toBe("Motijheel");
    await expect(updatePaymentAccount(cs, a.id, bank)).rejects.toThrow(ForbiddenError);
    await expect(movePaymentAccount(cs, a.id, "down")).rejects.toThrow(ForbiddenError);
    await expect(setShowOnPdf(cs, a.id, false)).rejects.toThrow(ForbiddenError);
    await expect(deletePaymentAccount(cs, a.id)).rejects.toThrow(ForbiddenError);

    await deletePaymentAccount(admin, c.id);
    expect((await listPaymentAccounts()).map((x) => x.id)).toEqual([b.id, a.id]);
    const log = await prisma.auditLog.findMany({ where: { entityType: "PaymentAccount" } });
    expect(log.some((l) => l.field === "branch" && l.newValue === "Motijheel")).toBe(true);
    expect(log.some((l) => l.action === "DELETE" && l.entityId === c.id)).toBe(true);
  });
});
