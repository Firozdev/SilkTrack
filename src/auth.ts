import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { clientIp, lockedMinutes, recordFailure, recordSuccess } from "@/lib/login-throttle";
import type { Locale, Role } from "@/generated/prisma/enums";

/** Too many wrong passwords; the login page shows a "try again later" message. */
export class LockedSignin extends CredentialsSignin {
  code = "locked";
}

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Always deployed behind our own proxy (Caddy or a tunnel) that sets the
  // public host; trust it even when AUTH_URL is not set.
  trustHost: true,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new CredentialsSignin();
        const { email, password } = parsed.data;
        const ip = clientIp(request);
        if (lockedMinutes(email, ip) > 0) throw new LockedSignin();

        const user = await prisma.user.findUnique({ where: { email } });
        // Same error for unknown email, wrong password and inactive user.
        if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
          recordFailure(email, ip);
          throw new CredentialsSignin();
        }
        recordSuccess(email, ip);

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          locale: user.locale,
          timezone: user.timezone,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.locale = user.locale;
        token.timezone = user.timezone;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      session.user.locale = token.locale as Locale;
      session.user.timezone = token.timezone as string;
      return session;
    },
  },
});
