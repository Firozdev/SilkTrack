import { getCurrentUser } from "@/lib/session";
import { ensureRateReminder, feed } from "@/server/notifications";

// Bell polling for staff: unread count, latest items and anything new since ?since=.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "ADMIN") await ensureRateReminder();
  const since = new URL(req.url).searchParams.get("since");
  const at = since ? new Date(since) : undefined;
  return Response.json(await feed({ userId: user.id }, at && !isNaN(at.getTime()) ? at : undefined), { headers: { "Cache-Control": "no-store" } });
}
