import { beforeEach, describe, expect, it } from "vitest";
import { BD_TZ, toYmd, today } from "@/lib/dates";
import { createRequest } from "@/server/requests";
import { estimatedPackaging } from "@/server/receiving";
import { makeRate, makeUser, quoteAndApprove, resetDb } from "../helpers";

describe("receiving prefill from the quotation", () => {
  beforeEach(async () => {
    await resetDb();
    const admin = await makeUser("ADMIN");
    await makeUser("CS");
    await makeUser("PURCHASE");
    await makeRate(toYmd(today(BD_TZ)), "17", admin.id);
  });

  it("uses quoted cartons, sizes and unit weight; scales for partial receipt", async () => {
    const cs = await makeUser("CS");
    const { order } = await createRequest(cs, { customer: { name: "P", phone: "0177", address: "x" }, shippingMethod: "AIR", lines: [{ productName: "Chair", quantity: 10, links: [] }] });
    await quoteAndApprove(order.id, "50", "9000", { cartonCount: 2, lengthCm: "60", widthCm: "50", heightCm: "40", unitWeightKg: "1.5" });
    const line = order.lines[0].id;

    const full = await estimatedPackaging([{ orderLineId: line, quantity: 10 }]);
    expect(full?.cartons).toHaveLength(2);
    expect(full?.cartons[0]).toMatchObject({ lengthCm: "60", widthCm: "50", heightCm: "40", grossWeightKg: "7.5" });
    expect(full?.grossWeightKg.toString()).toBe("15");
    expect(full?.cbm.toString()).toBe("0.24");

    const part = await estimatedPackaging([{ orderLineId: line, quantity: 3 }]);
    expect(part?.cartons).toHaveLength(1);
    expect(part?.grossWeightKg.toString()).toBe("4.5");
  });

  it("returns null when there is no quotation", async () => {
    expect(await estimatedPackaging([{ orderLineId: "none", quantity: 1 }])).toBeNull();
  });
});
