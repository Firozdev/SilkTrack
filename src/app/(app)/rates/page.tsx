import { redirect } from "next/navigation";

/** Old address: exchange rates now live under Settings. */
export default function RatesPage() {
  redirect("/settings/exchange-rates");
}
