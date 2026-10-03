import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest } from "@/server/requests";
import { searchCustomers } from "@/server/customers";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers";

let cs: Actor;
const line = [{ productName: "Item", quantity: 1, links: [] }];

describe("customer lookup", () => {
  beforeEach(async () => {
    await resetDb();
    cs = await makeUser("CS");
    await createRequest(cs, { customer: { name: "Rahim Uddin", phone: "01812-345678", address: "12 Lake Rd", district: "Dhaka" }, shippingMethod: "AIR", lines: line });
    await createRequest(cs, { customer: { name: "Karim Ahmed", phone: "01999000111", address: "5 Hill St" }, shippingMethod: "AIR", lines: line });
  });

  it("finds customers by name, phone digits or code", async () => {
    expect((await searchCustomers("rahim")).map((c) => c.name)).toEqual(["Rahim Uddin"]);
    expect((await searchCustomers("0181 2345")).map((c) => c.code)).toEqual(["C-00001"]);
    expect((await searchCustomers("C-00002")).map((c) => c.name)).toEqual(["Karim Ahmed"]);
    expect(await searchCustomers("r")).toEqual([]);
  });

  it("uses the picked customer and saves edited details with an audit trail", async () => {
    const [rahim] = await searchCustomers("rahim");
    const { order } = await createRequest(cs, {
      customer: { id: rahim.id, name: "Rahim Uddin", phone: "01812345678", address: "House 9, New Rd", district: "Dhaka" },
      shippingMethod: "SEA",
      lines: line,
    });
    expect(order.customerId).toBe(rahim.id);
    expect(await prisma.customer.count()).toBe(2);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: rahim.id } })).address).toBe("House 9, New Rd");
    const log = await prisma.auditLog.findMany({ where: { entityType: "Customer", entityId: rahim.id } });
    expect(log.map((l) => [l.field, l.oldValue, l.newValue])).toEqual([["address", "12 Lake Rd", "House 9, New Rd"]]);
  });

  it("does not log anything when the picked customer is unchanged", async () => {
    const [karim] = await searchCustomers("karim");
    await createRequest(cs, { customer: { id: karim.id, name: karim.name, phone: karim.phone, address: karim.address }, shippingMethod: "AIR", lines: line });
    expect(await prisma.auditLog.count({ where: { entityType: "Customer" } })).toBe(0);
  });

  it("rejects a customer id that does not exist", async () => {
    await expect(createRequest(cs, { customer: { id: "nope", name: "X", phone: "1", address: "x" }, shippingMethod: "AIR", lines: line })).rejects.toThrow(/no longer exists/);
  });
});
