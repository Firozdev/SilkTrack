import type { DefaultSession } from "next-auth";
import type { Locale, Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: Role;
    locale: Locale;
    timezone: string;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      locale: Locale;
      timezone: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    locale?: Locale;
    timezone?: string;
  }
}
