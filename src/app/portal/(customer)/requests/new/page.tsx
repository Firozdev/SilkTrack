import { getDict } from "../../../lang";
import { PortalRequestForm } from "./request-form";

export default async function PortalNewRequestPage() {
  const { t } = await getDict();
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">{t.buyForMe}</h1>
      <p className="mb-4 text-sm text-gray-500">{t.buyIntro}</p>
      <PortalRequestForm t={t} />
    </>
  );
}
