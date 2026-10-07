import { rateCard } from "@/server/shipping-rates";
import { getDict } from "../../../lang";
import { portalLabel } from "../../../labels";
import { ratesLine } from "../../estimate-box";
import { PortalRequestForm } from "./request-form";

export default async function PortalNewRequestPage() {
  const [{ lang, t }, rates] = await Promise.all([getDict(), rateCard()]);
  const line = ratesLine(t, rates, { air: portalLabel("AIR", lang), sea: portalLabel("SEA", lang) });
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t.buyForMe}</h1>
      <p className="mb-1 text-sm text-gray-500">{t.buyIntro}</p>
      {line && <p className="mb-4 text-sm text-emerald-800">{line}</p>}
      <PortalRequestForm t={t} />
    </>
  );
}
