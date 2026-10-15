import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";
import { AuthBackdrop } from "@/components/auth-backdrop";

export const metadata = { title: "Sign in · SilkTruck" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Checked against the database (not just the cookie) so a deactivated
  // user with a still-valid session sees the form instead of a redirect loop.
  if (await getCurrentUser()) redirect("/");
  const { callbackUrl } = await searchParams;
  return (
    <AuthBackdrop>
      <main className="flex min-h-dvh items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-xl border border-gray-200/80 bg-white/90 p-7 shadow-lg shadow-blue-900/5 backdrop-blur-sm">
          <h1 className="mb-1 text-2xl font-semibold">
            <Logo size={32} />
          </h1>
          <p className="mb-6 text-sm text-gray-500">Staff sign in</p>
          <LoginForm callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined} />
        </div>
      </main>
    </AuthBackdrop>
  );
}
