import { Alert } from "@/components/ui";
import { requirePortalAccount } from "@/lib/portal-session";
import { agentCustomers } from "@/server/portal-access";
import { rateCard } from "@/server/shipping-rates";
import { getDict } from "../../../lang";
import { portalLabel } from "../../../labels";
import { ratesLine } from "../../estimate-box";
import { PortalRequestForm } from "./request-form";

export default async function PortalNewRequestPage() {
  const acc = await requirePortalAccount();
  const [{ lang, t }, rates, customers] = await Promise.all([getDict(), rateCard(), acc.kind === "AGENT" ? agentCustomers(acc.id) : null]);
  const line = ratesLine(t, rates, { air: portalLabel("AIR", lang), sea: portalLabel("SEA", lang) });
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t.buyForMe}</h1>
      <p className="mb-1 text-sm text-gray-500">{t.buyIntro}</p>
      {line && <p className="mb-4 text-sm text-emerald-800">{line}</p>}
      {customers?.length === 0 ? <Alert tone="info">{t.needCustomerFirst}</Alert> : <PortalRequestForm t={t} customers={customers?.map(({ id, code, name, phone }) => ({ id, code, name, phone }))} />}
    </>
  );
}
