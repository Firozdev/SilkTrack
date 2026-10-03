import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/client";
import { ACTIONS, ForbiddenError, assertCan, can, canSeeSelling, redactFor, redactForRole } from "./permissions";

describe("can", () => {
  it("gives ADMIN every action", () => {
    for (const action of ACTIONS) expect(can("ADMIN", action)).toBe(true);
  });

  it("lets only ADMIN edit exchange rates and manage users", () => {
    for (const action of ["rate:edit", "user:manage", "audit:view", "report:profit"] as const) {
      expect(can("CS", action)).toBe(false);
      expect(can("PURCHASE", action)).toBe(false);
    }
  });

  it("lets CS create requests and see selling price and China cost", () => {
    expect(can("CS", "request:edit")).toBe(true);
    expect(can("CS", "price:viewSelling")).toBe(true);
    expect(can("CS", "cost:viewChina")).toBe(true);
    expect(can("CS", "purchase:edit")).toBe(false);
  });

  it("lets PURCHASE do China work but never see selling price or profit", () => {
    for (const action of ["purchase:edit", "estimate:edit", "receiving:edit", "shipment:edit"] as const) {
      expect(can("PURCHASE", action)).toBe(true);
    }
    expect(can("PURCHASE", "price:viewSelling")).toBe(false);
    expect(can("PURCHASE", "invoice:view")).toBe(false);
    expect(can("PURCHASE", "request:edit")).toBe(false);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan("PURCHASE", "rate:edit")).toThrow(ForbiddenError);
    expect(() => assertCan("ADMIN", "rate:edit")).not.toThrow();
  });
});

describe("redactForRole", () => {
  const order = {
    id: "o1",
    lines: [
      {
        id: "l1",
        quotedUnitPriceRmb: new Decimal("12.50"),
        sellingPriceBdt: new Decimal("2500.00"),
        purchaseLines: [{ totalRmb: new Decimal("12.50"), totalBdt: new Decimal("215.00") }],
      },
    ],
    estimates: [{ rmbSubtotal: new Decimal("100"), marginBdt: new Decimal("300"), grandTotalBdt: new Decimal("2000") }],
    invoices: [{ totalBdt: new Decimal("2500") }],
    payments: [{ amountBdt: new Decimal("1000") }],
    requestedAt: new Date("2026-10-01T00:00:00Z"),
  };

  it("removes selling price, margin, profit and billing for PURCHASE", () => {
    const r = redactForRole("PURCHASE", order);
    expect(r.lines[0]).not.toHaveProperty("sellingPriceBdt");
    expect(r.estimates[0]).not.toHaveProperty("marginBdt");
    expect(r.estimates[0]).not.toHaveProperty("grandTotalBdt");
    expect(r).not.toHaveProperty("invoices");
    expect(r).not.toHaveProperty("payments");
  });

  it("keeps China cost data, Decimals and Dates intact for PURCHASE", () => {
    const r = redactForRole("PURCHASE", order);
    expect(r.lines[0].quotedUnitPriceRmb).toBeInstanceOf(Decimal);
    expect(r.lines[0].purchaseLines[0].totalBdt.toString()).toBe("215");
    expect(r.estimates[0].rmbSubtotal.toString()).toBe("100");
    expect(r.requestedAt).toBeInstanceOf(Date);
  });

  it("does not mutate the input", () => {
    redactForRole("PURCHASE", order);
    expect(order.lines[0].sellingPriceBdt).toBeDefined();
  });

  it("returns data unchanged for ADMIN and CS", () => {
    expect(redactForRole("ADMIN", order)).toBe(order);
    expect(redactForRole("CS", order)).toBe(order);
  });
});

describe("per-user selling price permission", () => {
  const data = { lines: [{ sellingPriceBdt: "100", unitPriceRmb: "5" }], grandTotalBdt: "100", marginBdt: "20", payments: [{ amountBdt: "50" }] };

  it("PURCHASE with canSetSellingPrice sees selling price but never margin or payments", () => {
    const v = { role: "PURCHASE" as const, canSetSellingPrice: true };
    expect(canSeeSelling(v)).toBe(true);
    const r = redactFor(v, data);
    expect(r.lines[0].sellingPriceBdt).toBe("100");
    expect(r.grandTotalBdt).toBe("100");
    expect(r).not.toHaveProperty("marginBdt");
    expect(r).not.toHaveProperty("payments");
  });

  it("PURCHASE without it sees neither; the flag means nothing for CS", () => {
    const r = redactFor({ role: "PURCHASE" }, data);
    expect(r.lines[0]).not.toHaveProperty("sellingPriceBdt");
    expect(r).not.toHaveProperty("grandTotalBdt");
    expect(canSeeSelling({ role: "CS", canSetSellingPrice: false })).toBe(true);
    expect(redactFor({ role: "CS" }, data)).toBe(data);
  });
});
