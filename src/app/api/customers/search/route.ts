import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { searchCustomers } from "@/server/customers";

// Customer lookup for the request form.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(user.role, "request:edit")) return Response.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(await searchCustomers(q));
}
