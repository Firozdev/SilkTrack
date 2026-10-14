import { getCurrentUser } from "@/lib/session";
import { readAttachment } from "@/lib/uploads";
import { getOrganization } from "@/server/organization";

// The organization logo, for PDFs and Settings (signed-in staff).
// SVG is served sandboxed so any embedded script can never run.
export async function GET() {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { logo } = await getOrganization();
  if (!logo) return new Response("Not found", { status: 404 });
  try {
    const body = await readAttachment(logo.key);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": logo.mime,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
