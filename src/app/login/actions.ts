"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error?: string };

/** Only allow same-site relative paths, to avoid open redirects. */
function safeCallback(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeCallback(formData.get("callbackUrl")),
    });
    return {};
  } catch (error) {
    // signIn throws a redirect on success; let Next handle it.
    if (error instanceof AuthError) {
      return { error: "Wrong email or password, or the account is disabled." };
    }
    throw error;
  }
}
