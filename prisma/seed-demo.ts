// Demo records for the Admin dashboard's "New Requests" panels. Test databases only.
// Usage: npm run db:seed:demo   (each run adds another set)
import { prisma } from "../scripts/db";
import { hashPassword } from "../src/lib/password";

const PORTAL_PHONE = "01700000099";
const PORTAL_PASSWORD = "demo-pass-123";
const AGENT_PHONE = "01900000099";
const AGENT_PASSWORD = "agent-pass-123";

async function customer(code: string, name: string, phone: string) {
  return prisma.customer.upsert({ where: { code }, update: {}, create: { code, name, phone, address: "House 1, Road 2, Mirpur, Dhaka", district: "Dhaka" } });
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Run npm run db:seed first (no Admin user yet)");

  const portalCustomer = await customer("C-DEMO1", "Demo Portal Customer", PORTAL_PHONE);
  const staffCustomer = await customer("C-DEMO2", "Demo Walk-in Customer", "01700000098");
  const account = await prisma.portalAccount.upsert({
    where: { phone: PORTAL_PHONE },
    update: {},
    create: { phone: PORTAL_PHONE, name: portalCustomer.name, passwordHash: await hashPassword(PORTAL_PASSWORD), status: "ACTIVE", customerId: portalCustomer.id, address: portalCustomer.address, reviewedById: admin.id, reviewedAt: new Date() },
  });

  const line = (productName: string, quantity: number) => ({ lineNo: 1, productName, quantity, trackingEvents: { create: { leg: "SUPPLIER_TO_CHINA" as const, status: "REQUESTED" as const, message: "Demo request" } } });
  const buyPortal = await prisma.order.create({ data: { customerId: portalCustomer.id, source: "PORTAL", requestStatus: "SENT_TO_CHINA", shippingMethod: "AIR", lines: { create: [line("Desk lamp (demo)", 2)] } } });
  const buyStaff = await prisma.order.create({ data: { customerId: staffCustomer.id, source: "STAFF", createdById: admin.id, requestStatus: "SENT_TO_CHINA", shippingMethod: "SEA", lines: { create: [line("Office chair (demo)", 4)] } } });

  const item = (productName: string, quantity: number) => ({ lineNo: 1, productName, quantity });
  const event = { create: { status: "REQUESTED" as const, message: "Demo shipping request" } };
  const shipPortal = await prisma.shippingOrder.create({ data: { customerId: portalCustomer.id, source: "PORTAL", shippingMethod: "AIR", items: { create: [item("Sneakers (demo)", 3)] }, events: event } });
  await prisma.shippingOrder.create({ data: { customerId: staffCustomer.id, source: "STAFF", createdById: admin.id, shippingMethod: "SEA", items: { create: [item("Kitchen set (demo)", 1)] }, events: event } });

  const ref = `DEMO${Date.now().toString().slice(-6)}`;
  await prisma.paymentSubmission.create({ data: { customerId: portalCustomer.id, accountId: account.id, orderId: buyPortal.id, amountBdt: "1500.00", method: "BKASH", reference: ref, paidAt: new Date() } });
  await prisma.paymentSubmission.create({ data: { customerId: portalCustomer.id, accountId: account.id, shippingOrderId: shipPortal.id, amountBdt: "800.00", method: "NAGAD", reference: `${ref}N`, paidAt: new Date() } });

  // An agent with two customers and one request placed for each.
  const agent = await prisma.portalAccount.upsert({
    where: { phone: AGENT_PHONE },
    update: {},
    create: { kind: "AGENT", phone: AGENT_PHONE, name: "Demo Agent", passwordHash: await hashPassword(AGENT_PASSWORD), status: "ACTIVE", address: "", invitedById: admin.id, invitedAt: new Date() },
  });
  for (const [code, name, phone] of [
    ["C-DEMO3", "Demo Agent Customer A", "01700000097"],
    ["C-DEMO4", "Demo Agent Customer B", "01700000096"],
  ]) {
    const c = await customer(code, name, phone);
    await prisma.customer.update({ where: { id: c.id }, data: { agentAccountId: agent.id } });
    await prisma.order.create({ data: { customerId: c.id, source: "PORTAL", placedByAccountId: agent.id, requestStatus: "SENT_TO_CHINA", shippingMethod: "AIR", lines: { create: [line(`Phone case for ${name} (demo)`, 5)] } } });
  }

  await prisma.issue.create({ data: { type: "DAMAGED", source: "CHINA_RECEIVING", orderId: buyStaff.id, description: "Demo: carton arrived crushed, one chair leg broken", reportedById: admin.id } });

  console.log("Demo data added: 4 Buy for Me (2 by the agent), 2 Ship for Me, 2 payments to confirm, 1 open issue.");
  console.log(`Customer portal login: mobile ${PORTAL_PHONE} / password ${PORTAL_PASSWORD}`);
  console.log(`Agent portal login:    mobile ${AGENT_PHONE} / password ${AGENT_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
