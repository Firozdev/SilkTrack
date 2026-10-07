import { requirePortalAccount } from "@/lib/portal-session";
import { fill } from "../../../i18n";
import { getDict } from "../../../lang";
import { PortalShippingForm } from "./shipping-form";
import { rateCard } from "@/server/shipping-rates";

export default async function PortalNewShippingPage() {
  const acc = await requirePortalAccount();
  const [{ t }, rates] = await Promise.all([getDict(), rateCard()]);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t.shipMyGoods}</h1>
      <p className="mb-4 text-sm text-gray-500">{fill(t.shipIntro, { code: acc.customer.code })}</p>
      <PortalShippingForm t={t} rates={rates} />
    </>
  );
}
