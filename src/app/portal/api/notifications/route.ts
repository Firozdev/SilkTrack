import { getPortalAccount } from "@/lib/portal-session";
import { feed } from "@/server/notifications";

// Bell polling for customers and agents (under /portal so the portal cookie is sent).
export async function GET(req: Request) {
  const acc = await getPortalAccount();
  if (!acc) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const since = new URL(req.url).searchParams.get("since");
  const at = since ? new Date(since) : undefined;
  return Response.json(await feed({ accountId: acc.id }, at && !isNaN(at.getTime()) ? at : undefined), { headers: { "Cache-Control": "no-store" } });
}
