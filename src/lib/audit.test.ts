import { describe, expect, it, vi } from "vitest";
import { Decimal } from "@prisma/client/runtime/client";
import { diffFields, logChanges } from "./audit";

describe("diffFields", () => {
  it("reports changed price, rate, weight, CBM and status fields only", () => {
    const before = {
      unitPriceRmb: new Decimal("10.00"),
      rateUsed: new Decimal("17.2500"),
      grossWeightKg: new Decimal("1.200"),
      cbm: new Decimal("0.0100"),
      status: "PENDING",
      notes: "a",
    };
    const after = {
      unitPriceRmb: new Decimal("11.00"),
      rateUsed: new Decimal("17.2500"),
      grossWeightKg: new Decimal("1.500"),
      cbm: new Decimal("0.0120"),
      status: "PURCHASED",
      notes: "b",
    };
    expect(diffFields(before, after)).toEqual([
      { field: "unitPriceRmb", oldValue: "10", newValue: "11" },
      { field: "grossWeightKg", oldValue: "1.2", newValue: "1.5" },
      { field: "cbm", oldValue: "0.01", newValue: "0.012" },
      { field: "status", oldValue: "PENDING", newValue: "PURCHASED" },
    ]);
  });

  it("can include non-audited fields when asked", () => {
    expect(diffFields({ notes: "a" }, { notes: "b" }, false)).toHaveLength(1);
  });
});

describe("logChanges", () => {
  it("writes one row per changed field on UPDATE", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    await logChanges(
      { auditLog: { createMany } },
      {
        entityType: "ExchangeRate",
        entityId: "r1",
        userId: "u1",
        action: "UPDATE",
        changes: [
          { field: "rate", oldValue: "17.1", newValue: "17.3" },
          { field: "sellingRate", oldValue: null, newValue: "17.5" },
        ],
      },
    );
    const rows = createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entityType: "ExchangeRate", field: "rate", userId: "u1" });
  });

  it("writes nothing for an UPDATE without changes", async () => {
    const createMany = vi.fn();
    await logChanges({ auditLog: { createMany } }, { entityType: "X", entityId: "1", userId: null, action: "UPDATE" });
    expect(createMany).not.toHaveBeenCalled();
  });
});
