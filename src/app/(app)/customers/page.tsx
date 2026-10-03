import { A, Card, PageHeader, Table, btnCls, inputCls, tdCls } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/session";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  await requirePagePermission("request:edit");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const customers = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { code: { contains: q, mode: "insensitive" } }] }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { orders: true } } },
  });
  return (
    <>
      <PageHeader title="Customers" subtitle="Customers are created automatically from new requests." />
      <Card>
        <form className="mb-3 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Name, phone or code" className={`${inputCls} max-w-xs`} />
          <button className={btnCls}>Search</button>
        </form>
        <Table head={["Code", "Name", "Phone", "District / area", "Orders"]} empty="No customers.">
          {customers.map((c) => (
            <tr key={c.id}>
              <td className={tdCls}>
                <A href={`/customers/${c.id}`}>{c.code}</A>
              </td>
              <td className={tdCls}>{c.name}</td>
              <td className={tdCls}>{c.phone}</td>
              <td className={tdCls}>{[c.district, c.area].filter(Boolean).join(" / ")}</td>
              <td className={tdCls}>{c._count.orders}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
