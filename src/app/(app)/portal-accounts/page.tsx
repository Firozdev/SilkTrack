import { redirect } from "next/navigation";

/** Old address: portal logins are managed on the customers page now. */
export default function PortalAccountsPage() {
  redirect("/customers?portal=PENDING");
}
