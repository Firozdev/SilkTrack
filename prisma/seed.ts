import { prisma } from "../scripts/db";
import { hashPassword } from "../src/lib/password";

/** Placeholder defaults; Admin will be able to change them in Settings. */
const DEFAULT_SETTINGS: { key: string; value: unknown; description: string }[] = [
  {
    key: "bulk_threshold",
    value: { quantity: 50, valueBdt: "50000.00" },
    description: "Suggest BULK when total quantity or estimated value reaches this",
  },
  {
    key: "price_change_alert_pct",
    value: "5",
    description: "Flag purchase for BD approval when actual RMB price exceeds quoted by this %",
  },
  {
    key: "bd_weight_tolerance_pct",
    value: "5",
    description: "Flag BD receiving when weight differs from China weight by more than this %",
  },
  {
    key: "default_local_delivery_bdt",
    value: "120.00",
    description: "Default local delivery charge in BDT",
  },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";
  if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env");

  // Never overwrite an existing admin's password on re-seed.
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) },
  });
  console.log(`Admin user: ${admin.email}`);

  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, value: s.value as object, description: s.description },
    });
  }
  console.log(`Settings: ${DEFAULT_SETTINGS.length} defaults ensured`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
