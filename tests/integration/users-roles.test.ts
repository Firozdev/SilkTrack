import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, can, redactFor } from "@/lib/permissions";
import { verifyPassword } from "@/lib/password";
import { canOpenSection, navFor } from "@/lib/navigation";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createStaff, resetStaffPassword, setStaffActive, updateStaff } from "@/server/users";
import { createRequest, recordPayment } from "@/server/requests";
import { createPurchase, markShippedBySupplier } from "@/server/purchasing";
import { receiveParcel } from "@/server/receiving";
import { setShipmentStatus } from "@/server/shipments";
import { advanceOrder, bulkMoveShipmentOrders, moveOrderBack } from "@/server/order-stages";
import { getOrderView } from "@/server/order-view";
import { assignShippingOrder, createShippingOrder, deliverShipping, dispatchShipping, invoiceShipping, receiveShippingBd, receiveShippingChina, recordShippingPayment } from "@/server/shipping-orders";
import type { Actor } from "@/server/actor";
import { DONE, makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

let admin: Actor, cs: Actor, china: Actor;

describe("Settings → Users and the BD Warehouse role", () => {
  beforeEach(async () => {
    await resetDb();
    admin = await makeUser("ADMIN");
    cs = await makeUser("CS");
    china = await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17.0000", admin.id);
  });

  it("Admin adds, edits, disables and resets staff; safety rules hold; all audited", async () => {
    await expect(createStaff(cs, { name: "X", email: "x@a.com", role: "CS" })).rejects.toThrow(ForbiddenError);
    const { user: bd, password } = await createStaff(admin, { name: " Rafiq ", email: " Rafiq@Example.com ", role: "BD_WAREHOUSE" });
    expect([bd.name, bd.email, bd.role, bd.timezone, bd.active]).toEqual(["Rafiq", "rafiq@example.com", "BD_WAREHOUSE", "Asia/Dhaka", true]);
    expect(password).toMatch(/^\w{3}-\w{4}-\w{4}$/);
    expect(await verifyPassword(password, bd.passwordHash)).toBe(true);
    await expect(createStaff(admin, { name: "Y", email: "rafiq@example.com", role: "CS" })).rejects.toThrow(/already has this email/);
    await expect(createStaff(admin, { name: "Y", email: "y@example.com", role: "CS", password: "short" })).rejects.toThrow(/at least 8/);
    await expect(createStaff(admin, { name: "Y", email: "y@example.com", role: "CUSTOMER" })).rejects.toThrow(/Choose a role/);
    const { user: li } = await createStaff(admin, { name: "Li", email: "li@example.com", role: "PURCHASE", password: "china-pass-1", canSetSellingPrice: true });
    expect([li.timezone, li.locale, li.canSetSellingPrice]).toEqual(["Asia/Shanghai", "ZH_CN", true]);

    // Edit: role change; the selling-price option only applies to the China team
    await updateStaff(admin, bd.id, { name: "Rafiq", email: "rafiq@example.com", role: "CS", canSetSellingPrice: true, timezone: "Asia/Dhaka", locale: "BN" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: bd.id } })).toMatchObject({ role: "CS", locale: "BN", canSetSellingPrice: false });

    // Can't lock yourself out; always one active Admin
    await expect(updateStaff(admin, admin.id, { name: "A", email: (await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).email, role: "CS", timezone: "Asia/Dhaka", locale: "EN" })).rejects.toThrow(/your own Admin role/);
    await expect(setStaffActive(admin, admin.id, false)).rejects.toThrow(/your own login/);
    const { user: admin2 } = await createStaff(admin, { name: "Second", email: "second@example.com", role: "ADMIN" });
    const a2: Actor = { id: admin2.id, role: "ADMIN" };
    await setStaffActive(a2, admin.id, false);
    await expect(setStaffActive({ id: cs.id, role: "ADMIN" }, admin2.id, false)).rejects.toThrow(/at least one active Admin/);
    await setStaffActive(a2, admin.id, true);

    // Disable / enable and reset password
    await setStaffActive(admin, bd.id, false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bd.id } })).active).toBe(false);
    await setStaffActive(admin, bd.id, true);
    const p2 = await resetStaffPassword(admin, bd.id, "new-pass-123");
    expect(await verifyPassword(p2, (await prisma.user.findUniqueOrThrow({ where: { id: bd.id } })).passwordHash)).toBe(true);
    await expect(resetStaffPassword(cs, bd.id)).rejects.toThrow(ForbiddenError);

    const audit = await prisma.auditLog.findMany({ where: { entityType: "User", entityId: bd.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.field, a.newValue])).toEqual([
      ["email", "rafiq@example.com"],
      ["role", "BD_WAREHOUSE"],
      ["role", "CS"],
      ["locale", "BN"],
      ["active", "false"],
      ["active", "true"],
      ["password", "reset"],
    ]);
  });

  it("BD Warehouse: arrival onwards and warehouse steps; no money steps, prices or office sections", async () => {
    const bd: Actor = { id: (await createStaff(admin, { name: "BD", email: "bd@example.com", role: "BD_WAREHOUSE" })).user.id, role: "BD_WAREHOUSE" };
    expect(navFor("BD_WAREHOUSE").map((n) => n.label)).toEqual(["Dashboard", "Requests", "Shipping service", "Shipments", "Issues"]);
    for (const s of ["quotations", "samples", "purchasing", "receiving", "settings"] as const) expect(canOpenSection("BD_WAREHOUSE", s), s).toBe(false);
    expect(["price:viewSelling", "cost:viewChina", "payment:record", "invoice:edit", "settings:manage", "user:manage"].some((a) => can("BD_WAREHOUSE", a as never))).toBe(false);

    // A Buy for Me order received into a shipment
    const { order } = await createRequest(cs, { customer: { name: "R", phone: "01811000000", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Bag", quantity: 1, links: [] }] });
    await quoteAndApprove(order.id, "10", "999");
    await recordPayment(cs, order.id, { type: "ADVANCE", amountBdt: "100", method: "CASH" });
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id } });
    const so = await createPurchase(china, { ...DONE, supplierName: "S", platform: "TAOBAO", lines: lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity, unitPriceRmb: "10" })) });
    await markShippedBySupplier(china, so.id, { courierName: "YTO", trackingNo: "YT1" });
    const pls = await prisma.purchaseLine.findMany({ where: { supplierOrderId: so.id } });
    const r = await receiveParcel(china, { supplierOrderId: so.id, condition: "OK", grossWeightKg: "2", cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30" }], shippingMethod: "AIR", shipmentId: "auto", lines: pls.map((p) => ({ purchaseLineId: p.id, quantityReceived: p.quantity, condition: "OK" as const })) });
    const shipmentId = r.shipment!.id;

    // China sends it; BD warehouse can't do China's steps, China can't mark arrival
    await expect(setShipmentStatus(bd, shipmentId, "CLOSED")).rejects.toThrow(ForbiddenError);
    for (const st of ["CLOSED", "DEPARTED"] as const) await setShipmentStatus(china, shipmentId, st);
    await expect(setShipmentStatus(china, shipmentId, "ARRIVED_BD")).rejects.toThrow(/Only Admin or BD Warehouse/);
    await setShipmentStatus(bd, shipmentId, "ARRIVED_BD");
    await setShipmentStatus(bd, shipmentId, "CUSTOMS_CLEARED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CUSTOMS_CLEARED");

    // Money steps are Admin's (one order or the whole shipment); moving back is Admin's
    await expect(advanceOrder(bd, order.id)).rejects.toThrow(/done by Admin/);
    await expect(bulkMoveShipmentOrders(bd, shipmentId, "INVOICE_SHARED")).rejects.toThrow(ForbiddenError);
    await expect(moveOrderBack(bd, order.id, "wrong order")).rejects.toThrow(ForbiddenError);
    await advanceOrder(admin, order.id); // invoice shared
    await advanceOrder(admin, order.id); // payment collected
    // Then the warehouse takes it to the door
    for (const st of ["READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]) expect(await advanceOrder(bd, order.id)).toBe(st);
    const ev = await prisma.trackingEvent.findFirstOrThrow({ where: { orderLine: { orderId: order.id }, status: "DELIVERED" } });
    expect(ev.createdById).toBe(bd.id);

    // No selling prices / costs on the order for the warehouse
    const view = (await getOrderView(order.id, { role: "BD_WAREHOUSE" }))!;
    expect(JSON.stringify(redactFor({ role: "BD_WAREHOUSE" }, view.lines))).not.toMatch(/sellingPriceBdt|quotedUnitPriceRmb/);
  });

  it("BD Warehouse does Ship for Me receiving and delivery; CS still can; invoicing stays with CS / Admin", async () => {
    const bd: Actor = { id: (await createStaff(admin, { name: "BD", email: "bd@example.com", role: "BD_WAREHOUSE" })).user.id, role: "BD_WAREHOUSE" };
    const so = await createShippingOrder(cs, { customer: { name: "K", phone: "01911000000", address: "x" }, shippingMethod: "AIR", qaRequested: false, items: [{ productName: "Shoes", quantity: 1 }] });
    const item = await prisma.shippingOrderItem.findFirstOrThrow({ where: { shippingOrderId: so.id } });
    await receiveShippingChina(china, so.id, { items: [{ itemId: item.id, quantityReceived: 1, condition: "OK" }], cartons: [{ lengthCm: "50", widthCm: "40", heightCm: "30", grossWeightKg: "2" }] });
    await assignShippingOrder(china, so.id, "auto");
    await expect(receiveShippingBd(china, so.id)).rejects.toThrow(ForbiddenError);
    await receiveShippingBd(bd, so.id);
    await expect(invoiceShipping(bd, so.id, { ratePerUnitBdt: "800" })).rejects.toThrow(ForbiddenError);
    await invoiceShipping(cs, so.id, { ratePerUnitBdt: "800" });
    await recordShippingPayment(cs, so.id, { amountBdt: "1600", method: "CASH" });
    await dispatchShipping(bd, so.id, { courier: "PATHAO", trackingNo: "PT-1" });
    await deliverShipping(bd, so.id, "Karim");
    expect((await prisma.shippingOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("DELIVERED");
  });
});
