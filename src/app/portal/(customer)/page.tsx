import Link from "next/link";
import { A, Card, Dl, Table, btnCls, btnPrimaryCls, tdCls } from "@/components/ui";
import { BD_TZ, fmtDateTime } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalDashboard } from "@/server/portal";
import { fill } from "../i18n";
import { portalLabel } from "../labels";
import { getDict } from "../lang";
import { PStatus } from "../portal-ui";

export default async function PortalHome() {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  const d = await portalDashboard(acc.customer.id);
  const products = (l: { productName: string; quantity: number }[]) => l.map((x) => `${x.productName} × ${x.quantity}`).join(", ");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{fill(t.hello, { name: acc.customer.name })}</h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/portal/requests/new" className={btnPrimaryCls}>
            + {t.buyForMe}
          </Link>
          <Link href="/portal/shipping/new" className={btnCls}>
            + {t.shipMyGoods}
          </Link>
        </div>
      </div>
      <Card title={t.myAccount}>
        <Dl
          items={[
            [t.totalBilled, fmtBdt(d.ledger.invoiced)],
            [t.paid, fmtBdt(d.ledger.paid)],
            [t.balanceDue, <b key="b" className={d.ledger.balance.gt(0) ? "text-red-700" : "text-green-700"}>{fmtBdt(d.ledger.balance.isNeg() ? 0 : d.ledger.balance)}</b>],
            [t.deliveryAddress, `${acc.customer.address}${acc.customer.district ? `, ${acc.customer.district}` : ""}`],
          ]}
        />
      </Card>
      <Card title={t.requestsTitle}>
        <Table head={[t.colRequest, t.colProducts, t.colShipBy, t.colDate, t.colStatus]} empty={t.noRequests}>
          {d.orders.map((o) => (
            <tr key={o.id}>
              <td className={tdCls}>
                <A href={`/portal/requests/${o.id}`}>{docNo("order", o.number)}</A>
              </td>
              <td className={tdCls}>{products(o.lines)}</td>
              <td className={tdCls}>{portalLabel(o.shippingMethod, lang)}</td>
              <td className={tdCls}>{fmtDateTime(o.requestedAt, BD_TZ)}</td>
              <td className={tdCls}>
                <PStatus lang={lang} value={o.status === "REQUESTED" ? o.requestStatus : o.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={t.shippingTitle}>
        <Table head={[t.colOrder, t.colProducts, t.colShipBy, t.colDate, t.colStatus]} empty={t.noShipping}>
          {d.shipping.map((s) => (
            <tr key={s.id}>
              <td className={tdCls}>
                <A href={`/portal/shipping/${s.id}`}>{docNo("shippingOrder", s.number)}</A>
              </td>
              <td className={tdCls}>{products(s.items)}</td>
              <td className={tdCls}>{portalLabel(s.shippingMethod, lang)}</td>
              <td className={tdCls}>{fmtDateTime(s.createdAt, BD_TZ)}</td>
              <td className={tdCls}>
                <PStatus lang={lang} value={s.status} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {d.samples.length > 0 && (
        <Card title={t.samples}>
          <Table head={[t.colSample, t.colProducts, t.colDate, t.colStatus]}>
            {d.samples.map((s) => (
              <tr key={s.id}>
                <td className={tdCls}>
                  <A href={`/portal/samples/${s.id}`}>{docNo("sample", s.number)}</A>
                </td>
                <td className={tdCls}>{products(s.lines)}</td>
                <td className={tdCls}>{fmtDateTime(s.requestedAt, BD_TZ)}</td>
                <td className={tdCls}>
                  <PStatus lang={lang} value={s.status} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
