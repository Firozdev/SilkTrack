import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { A, Card, Dl, Field, Table, btnCls, btnPrimaryCls, inputCls, tdCls } from "@/components/ui";
import { BD_TZ, fmtDateTime } from "@/lib/dates";
import { docNo, fmtBdt } from "@/lib/format";
import { requirePortalAccount } from "@/lib/portal-session";
import { portalDashboard, portalLists } from "@/server/portal";
import { agentCustomers } from "@/server/portal-access";
import { portalAddCustomerAction } from "../actions";
import { fill, type Dict, type Lang } from "../i18n";
import { portalLabel } from "../labels";
import { getDict } from "../lang";
import { PStatus } from "../portal-ui";

const products = (l: { productName: string; quantity: number }[]) => l.map((x) => `${x.productName} × ${x.quantity}`).join(", ");

function NewButtons({ t }: { t: Dict }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/portal/requests/new" className={btnPrimaryCls}>
        + {t.buyForMe}
      </Link>
      <Link href="/portal/shipping/new" className={btnCls}>
        + {t.shipMyGoods}
      </Link>
    </div>
  );
}

export default async function PortalHome() {
  const acc = await requirePortalAccount();
  const { lang, t } = await getDict();
  if (acc.kind === "AGENT") return <AgentHome accountId={acc.id} name={acc.name} lang={lang} t={t} />;
  const d = await portalDashboard(acc.customer.id);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{fill(t.hello, { name: acc.customer.name })}</h1>
        <NewButtons t={t} />
      </div>
      <Card title={t.myAccount}>
        <Dl
          items={[
            [t.totalBilled, fmtBdt(d.ledger.invoiced)],
            [t.paid, fmtBdt(d.ledger.paid)],
            [
              t.balanceDue,
              <b key="b" className={d.ledger.balance.gt(0) ? "text-red-700" : "text-green-700"}>
                {fmtBdt(d.ledger.balance.isNeg() ? 0 : d.ledger.balance)}
              </b>,
            ],
            [t.deliveryAddress, `${acc.customer.address}${acc.customer.district ? `, ${acc.customer.district}` : ""}`],
          ]}
        />
      </Card>
      <Lists d={d} lang={lang} t={t} />
    </div>
  );
}

/** An agent's home: their customers (with balances, and a form to add one) and every order of those customers. */
async function AgentHome({ accountId, name, lang, t }: { accountId: string; name: string; lang: Lang; t: Dict }) {
  const customers = await agentCustomers(accountId);
  const d = await portalLists(customers.map((c) => c.id));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">
          {fill(t.agentHello, { name })} <span className="ml-1 rounded bg-blue-50 px-2 py-0.5 align-middle text-xs font-medium text-blue-800">{t.agentTag}</span>
        </h1>
        {customers.length > 0 && <NewButtons t={t} />}
      </div>
      <Card title={`${t.myCustomers} (${customers.length})`}>
        <Table head={[t.colCustomer, t.mobile, t.deliveryAddress, t.balanceDue]} empty={t.noCustomers}>
          {customers.map((c) => (
            <tr key={c.id}>
              <td className={tdCls}>
                {c.name} <span className="text-xs text-gray-500">{c.code}</span>
              </td>
              <td className={tdCls}>{c.phone}</td>
              <td className={tdCls}>
                {c.address}
                {c.district ? `, ${c.district}` : ""}
              </td>
              <td className={`${tdCls} tabular-nums ${c.ledger.balance.gt(0) ? "text-red-700" : ""}`}>{fmtBdt(c.ledger.balance.isNeg() ? 0 : c.ledger.balance)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={t.addCustomer}>
        <p className="mb-3 text-sm text-gray-500">{t.addCustomerIntro}</p>
        <ActionForm action={portalAddCustomerAction} submitLabel={t.addCustomer} resetOnSuccess className="max-w-xl">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.fullName}>
              <input name="name" required className={inputCls} />
            </Field>
            <Field label={t.mobileReq}>
              <input name="phone" type="tel" inputMode="tel" required placeholder="01XXXXXXXXX" className={inputCls} />
            </Field>
          </div>
          <Field label={t.addressReq}>
            <textarea name="address" required rows={2} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.district}>
              <input name="district" className={inputCls} />
            </Field>
            <Field label={t.area}>
              <input name="area" className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      </Card>
      <Lists d={d} lang={lang} t={t} showCustomer />
    </div>
  );
}

type ListData = Awaited<ReturnType<typeof portalLists>>;

function Lists({ d, lang, t, showCustomer = false }: { d: ListData; lang: Lang; t: Dict; showCustomer?: boolean }) {
  const who = (c: { code: string; name: string }) =>
    showCustomer ? (
      <td className={tdCls}>
        {c.name} <span className="text-xs text-gray-500">{c.code}</span>
      </td>
    ) : null;
  const col = showCustomer ? [t.colCustomer] : [];
  return (
    <>
      <Card title={t.requestsTitle}>
        <Table head={[t.colRequest, ...col, t.colProducts, t.colShipBy, t.colDate, t.colStatus]} empty={t.noRequests}>
          {d.orders.map((o) => (
            <tr key={o.id}>
              <td className={tdCls}>
                <A href={`/portal/requests/${o.id}`}>{docNo("order", o.number)}</A>
              </td>
              {who(o.customer)}
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
        <Table head={[t.colOrder, ...col, t.colProducts, t.colShipBy, t.colDate, t.colStatus]} empty={t.noShipping}>
          {d.shipping.map((s) => (
            <tr key={s.id}>
              <td className={tdCls}>
                <A href={`/portal/shipping/${s.id}`}>{docNo("shippingOrder", s.number)}</A>
              </td>
              {who(s.customer)}
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
          <Table head={[t.colSample, ...col, t.colProducts, t.colDate, t.colStatus]}>
            {d.samples.map((s) => (
              <tr key={s.id}>
                <td className={tdCls}>
                  <A href={`/portal/samples/${s.id}`}>{docNo("sample", s.number)}</A>
                </td>
                {who(s.customer)}
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
    </>
  );
}
