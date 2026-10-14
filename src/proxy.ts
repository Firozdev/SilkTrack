import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Optimistic check only: send signed-out staff to /login.
// Real authorization happens in pages/actions via src/lib/session.ts.
// The customer portal (/portal) has its own session (src/lib/portal-session.ts).
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/login" || pathname === "/portal" || pathname.startsWith("/portal/");

  if (!req.auth && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // Everything except the auth API, Next internals and static files.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
