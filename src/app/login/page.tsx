import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · SilkTrack" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Checked against the database (not just the cookie) so a deactivated
  // user with a still-valid session sees the form instead of a redirect loop.
  if (await getCurrentUser()) redirect("/");
  const { callbackUrl } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">SilkTrack</h1>
        <p className="mb-6 text-sm text-gray-500">Sign in to continue</p>
        <LoginForm callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined} />
      </div>
    </main>
  );
}
