import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { readAttachment } from "@/lib/uploads";

// Serves uploaded files to signed-in users only.
export async function GET(_req: Request, ctx: RouteContext<"/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) return new Response("Not found", { status: 404 });
  try {
    const body = await readAttachment(att.storageKey);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(att.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
