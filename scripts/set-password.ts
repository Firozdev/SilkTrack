// Usage: npm run user:password -- --email a@b.com --password 'new-strong-password'
import { parseArgs } from "node:util";
import { prisma } from "./db";
import { hashPassword } from "../src/lib/password";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, password: { type: "string" } } });
  if (!values.email || !values.password) throw new Error("Required: --email --password");
  const user = await prisma.user.update({
    where: { email: values.email.trim().toLowerCase() },
    data: { passwordHash: await hashPassword(values.password) },
  });
  await prisma.auditLog.create({ data: { entityType: "User", entityId: user.id, action: "UPDATE", field: "password", newValue: "(changed)" } });
  console.log(`Password changed for ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
