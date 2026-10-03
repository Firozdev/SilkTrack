// Usage: npm run user:allow-selling -- --email li@example.com [--off]
// Lets a China (PURCHASE) user set and see customer selling prices (never margin/profit).
import { parseArgs } from "node:util";
import { prisma } from "./db";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, off: { type: "boolean" } } });
  if (!values.email) throw new Error("Required: --email");
  const user = await prisma.user.findUnique({ where: { email: values.email.trim().toLowerCase() } });
  if (!user) throw new Error(`No user ${values.email}`);
  if (user.role !== "PURCHASE") throw new Error(`${user.email} is ${user.role}; this setting only applies to PURCHASE users`);
  const on = !values.off;
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { canSetSellingPrice: on } }),
    prisma.auditLog.create({ data: { entityType: "User", entityId: user.id, action: "UPDATE", field: "canSetSellingPrice", oldValue: user.canSetSellingPrice, newValue: on } }),
  ]);
  console.log(`${user.email}: canSetSellingPrice = ${on}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
