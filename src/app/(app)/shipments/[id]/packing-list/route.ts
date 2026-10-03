import { csvResponse, toCsv } from "@/lib/csv";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { packingList } from "@/server/shipments";

export async function GET(_req: Request, ctx: RouteContext<"/shipments/[id]/packing-list">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const s = await prisma.shipment.findUnique({ where: { id }, select: { code: true } });
  if (!s) return new Response("Not found", { status: 404 });
  const rows = await packingList(id);
  return csvResponse(
    toCsv(rows, [
      { key: "customerCode", label: "Customer code" },
      { key: "customerName", label: "Customer" },
      { key: "phone", label: "Phone" },
      { key: "district", label: "District" },
      { key: "order", label: "Order" },
      { key: "parcel", label: "Parcel" },
      { key: "cartonMark", label: "Carton mark" },
      { key: "product", label: "Product" },
      { key: "qty", label: "Qty" },
      { key: "cartons", label: "Cartons (parcel)" },
      { key: "grossKg", label: "Gross kg (parcel)" },
      { key: "cbm", label: "CBM (parcel)" },
    ]),
    `${s.code}-packing-list.csv`,
  );
}
