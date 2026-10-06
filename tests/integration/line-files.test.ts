import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveItemFiles, saveSampleLineFiles } from "@/server/line-files";
import { createPortalShippingOrder, createShippingOrder } from "@/server/shipping-orders";
import { createStandaloneSample } from "@/server/samples";
import { approveAccount, signUp } from "@/server/portal-auth";
import { portalAttachment, portalShippingOrder } from "@/server/portal";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let cs: Actor;
const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });

describe("Files on product lines", () => {
  beforeEach(async () => {
    await resetDb();
    cs = await makeUser("CS");
  });

  it("shipping order: each row's files land on its own item, photos and PDFs", async () => {
    const rows = [
      { _i: "0", productName: "Shoes", quantity: 2 },
      { _i: "3", productName: "Empty row", quantity: 0 }, // dropped by create – must not shift the others
      { _i: "5", productName: "Bags", quantity: 1 },
    ];
    const so = await createShippingOrder(cs, { customer: { name: "R", phone: "01700000000", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: rows });
    const fd = new FormData();
    fd.append("p.0.files", png("shoe.png"));
    fd.append("p.3.files", png("ignored.png"));
    fd.append("p.5.files", pdf("bag-invoice.pdf"));
    fd.append("p.5.files", png("bag.png"));
    await saveItemFiles(fd, rows, so.id, cs.id);

    const items = await prisma.shippingOrderItem.findMany({ where: { shippingOrderId: so.id }, orderBy: { lineNo: "asc" }, include: { attachments: { orderBy: { fileName: "asc" } } } });
    expect(items.map((i) => [i.productName, i.attachments.map((a) => `${a.fileName}:${a.kind}`)])).toEqual([
      ["Shoes", ["shoe.png:PRODUCT_IMAGE"]],
      ["Bags", ["bag-invoice.pdf:OTHER", "bag.png:PRODUCT_IMAGE"]],
    ]);
    expect(await prisma.attachment.count({ where: { fileName: "ignored.png" } })).toBe(0);
  });

  it("sample: files are matched to the line with the same product name", async () => {
    const rows = [
      { _i: "0", productName: "Lamp", quantity: 1 },
      { _i: "1", productName: "Shade", quantity: 2 },
    ];
    const s = await createStandaloneSample(cs, { customer: { name: "R", phone: "01700000000", address: "x" }, lines: rows });
    const fd = new FormData();
    fd.append("p.1.files", pdf("shade-spec.pdf"));
    await saveSampleLineFiles(fd, rows, s.id, cs.id);
    const lines = await prisma.sampleLine.findMany({ where: { sampleId: s.id }, include: { attachments: true } });
    expect(lines.find((l) => l.productName === "Shade")?.attachments.map((a) => a.fileName)).toEqual(["shade-spec.pdf"]);
    expect(lines.find((l) => l.productName === "Lamp")?.attachments).toEqual([]);
  });

  it("customers see files on their own lines only", async () => {
    const mk = async (phone: string) => {
      const acc = await signUp({ name: phone, phone, password: "secret-pass-1", address: "x" });
      await approveAccount(cs, acc.id, "new");
      return prisma.portalAccount.findUniqueOrThrow({ where: { id: acc.id } });
    };
    const a = await mk("01711000000");
    const b = await mk("01811000000");
    const rows = [{ _i: "0", productName: "Chair", quantity: 4 }];
    const so = await createPortalShippingOrder(a.customerId!, { shippingMethod: "SEA", qaRequested: false, items: rows });
    const fd = new FormData();
    fd.append("p.0.files", png("chair.png"));
    await saveItemFiles(fd, rows, so.id, { accountId: a.id });

    const att = await prisma.attachment.findFirstOrThrow({ where: { fileName: "chair.png" } });
    expect([att.uploadedByAccountId, att.uploadedById]).toEqual([a.id, null]);
    expect(await portalAttachment(a.customerId!, att.id)).not.toBeNull();
    expect(await portalAttachment(b.customerId!, att.id)).toBeNull();
    const view = await portalShippingOrder(a.customerId!, so.id);
    expect(view?.items[0].attachments.map((x) => x.fileName)).toEqual(["chair.png"]);
  });
});
