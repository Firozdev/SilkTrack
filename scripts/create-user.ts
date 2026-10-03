// Usage: npm run user:create -- --email a@b.com --name "Rahim" --role CS --password secret123 [--timezone Asia/Shanghai] [--locale ZH_CN]
import { parseArgs } from "node:util";
import { prisma } from "./db";
import { hashPassword } from "../src/lib/password";
import { Locale, Role } from "../src/generated/prisma/enums";

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      password: { type: "string" },
      timezone: { type: "string" },
      locale: { type: "string" },
    },
  });
  const { email, name, role, password } = values;
  if (!email || !name || !role || !password) {
    throw new Error("Required: --email --name --role (ADMIN|CS|PURCHASE) --password");
  }
  if (!(role in Role)) throw new Error(`Unknown role ${role}`);
  if (values.locale && !(values.locale in Locale)) throw new Error(`Unknown locale ${values.locale}`);

  const isChina = role === "PURCHASE";
  const user = await prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      name,
      role: role as Role,
      passwordHash: await hashPassword(password),
      timezone: values.timezone ?? (isChina ? "Asia/Shanghai" : "Asia/Dhaka"),
      locale: (values.locale as Locale | undefined) ?? (isChina ? "ZH_CN" : "EN"),
    },
  });
  console.log(`Created ${user.role} user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
