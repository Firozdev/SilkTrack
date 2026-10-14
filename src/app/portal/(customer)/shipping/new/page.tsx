import { Alert } from "@/components/ui";
import { requirePortalAccount } from "@/lib/portal-session";
import { agentCustomers } from "@/server/portal-access";
import { fill } from "../../../i18n";
import { getDict } from "../../../lang";
import { PortalShippingForm } from "./shipping-form";
import { rateCard } from "@/server/shipping-rates";

export default async function PortalNewShippingPage() {
  const acc = await requirePortalAccount();
  const [{ t }, rates, customers] = await Promise.all([getDict(), rateCard(), acc.kind === "AGENT" ? agentCustomers(acc.id) : null]);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t.shipMyGoods}</h1>
      <p className="mb-4 text-sm text-gray-500">{acc.kind === "AGENT" ? t.shipIntroAgent : fill(t.shipIntro, { code: acc.customer.code })}</p>
      {customers?.length === 0 ? <Alert tone="info">{t.needCustomerFirst}</Alert> : <PortalShippingForm t={t} rates={rates} customers={customers?.map(({ id, code, name, phone }) => ({ id, code, name, phone }))} />}
    </>
  );
}
