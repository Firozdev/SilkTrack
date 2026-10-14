// Demo records for the Admin dashboard's "New Requests" panels. Test databases only.
// Usage: npm run db:seed:demo   (each run adds another set)
import { prisma } from "../scripts/db";
import { hashPassword } from "../src/lib/password";
import { RULES, type EventType } from "../src/lib/notifications/rules";
import { render, type Data } from "../src/lib/notifications/templates";
import type { Role } from "../src/generated/prisma/enums";

const PORTAL_PHONE = "01700000099";
const PORTAL_PASSWORD = "demo-pass-123";
const AGENT_PHONE = "01900000099";
const AGENT_PASSWORD = "agent-pass-123";
const STAFF_PASSWORD = "staff-pass-123";

/** Demo CS and China logins (only created if the email is free). */
async function staffUser(email: string, name: string, role: Role, timezone: string) {
  return prisma.user.upsert({ where: { email }, update: {}, create: { email, name, role, timezone, passwordHash: await hashPassword(STAFF_PASSWORD) } });
}

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
  const buyPortal = await prisma.order.create({ data: { customerId: portalCustomer.id, source: "PORTAL", requestStatus: "NEW", shippingMethod: "AIR", lines: { create: [line("Desk lamp (demo)", 2)] } } });
  // A request where the customer asked for a QA test (China tests it after receiving, before shipping).
  await prisma.order.create({ data: { customerId: portalCustomer.id, source: "PORTAL", requestStatus: "NEW", qaRequested: true, shippingMethod: "AIR", lines: { create: [line("Bluetooth speaker – QA test (demo)", 10)] } } });
  const buyStaff = await prisma.order.create({ data: { customerId: staffCustomer.id, source: "STAFF", createdById: admin.id, requestStatus: "NEW", shippingMethod: "SEA", lines: { create: [line("Office chair (demo)", 4)] } } });

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
    await prisma.order.create({ data: { customerId: c.id, source: "PORTAL", placedByAccountId: agent.id, requestStatus: "NEW", shippingMethod: "AIR", lines: { create: [line(`Phone case for ${name} (demo)`, 5)] } } });
  }

  const issue = await prisma.issue.create({ data: { type: "DAMAGED", source: "CHINA_RECEIVING", orderId: buyStaff.id, description: "Demo: carton arrived crushed, one chair leg broken", reportedById: admin.id } });

  // The demo customer's Ship for Me order travels in this week's air shipment (Shipment box in the portal).
  const now = new Date();
  const ymd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = ymd.getUTCDay() || 7;
  const monday = new Date(ymd.getTime() - (dow - 1) * 86_400_000);
  const thursday = new Date(monday.getTime() + 3 * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  const plusDays = (n: number) => new Date(monday.getTime() + n * 86_400_000);
  const shipment = await prisma.shipment.upsert({
    where: { year_weekNumber_method: { year, weekNumber: week, method: "AIR" } },
    update: {},
    create: { code: `SHP-${year}-W${String(week).padStart(2, "0")}-A`, year, weekNumber: week, method: "AIR", status: "OPEN", cutoffDate: plusDays(4), plannedDepartureDate: plusDays(6), etaBd: plusDays(11) },
  });
  await prisma.shippingOrder.update({ where: { id: shipPortal.id }, data: { shipmentId: shipment.id, status: "IN_SHIPMENT", receivedChinaAt: new Date(), cartonCount: 1, grossWeightKg: "4.5", cbm: "0.06" } });

  // A Ship for Me order received in Bangladesh and invoiced (4.5 kg × ৳850 + ৳120 delivery − ৳25) with a partial payment:
  // open it in the staff app → "Download invoice PDF" and the payment's receipt PDF (made on first download).
  const rate = await prisma.exchangeRate.findFirst({ orderBy: { effectiveDate: "desc" } });
  const invoiced = await prisma.shippingOrder.create({
    data: {
      customerId: portalCustomer.id,
      source: "PORTAL",
      shippingMethod: "AIR",
      status: "INVOICED",
      shipmentId: shipment.id,
      items: { create: [item("Winter jackets (demo)", 4)] },
      events: event,
      receivedChinaAt: new Date(),
      receivedBdAt: new Date(),
      cartonCount: 1,
      grossWeightKg: "4.5",
      cbm: "0.05",
      billWeightKg: "4.5",
      shipRatePerKgBdt: "850",
      shippingChargeBdt: "3825.00",
      localDeliveryBdt: "120.00",
      discountBdt: "25.00",
      invoiceTotalBdt: "3920.00",
      rateUsed: rate?.rate,
      exchangeRateId: rate?.id,
      invoicedById: admin.id,
      invoicedAt: new Date(),
      invoiceDueDate: new Date(Date.now() + 7 * 86_400_000),
      invoiceNotes: "Demo invoice – please pay within 7 days.",
    },
  });
  await prisma.payment.create({ data: { shippingOrderId: invoiced.id, type: "SHIPPING_SERVICE", amountBdt: "2000.00", method: "BKASH", reference: "DEMO-TRX-1", receivedById: admin.id, paidAt: new Date() } });
  // The demo customer's own resale version of that invoice (portal → order → My versions).
  await prisma.customInvoice.create({
    data: {
      accountId: account.id,
      shippingOrderId: invoiced.id,
      label: "For Rahim Traders",
      data: {
        label: "For Rahim Traders",
        business: { name: "Demo Portal Customer Ltd", phone: PORTAL_PHONE, email: "sales@demo-customer.test", address: "Shop 4, Mirpur 10, Dhaka" },
        invoiceNo: "DPC-001",
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: "",
        billTo: { name: "Rahim Traders", phone: "01811000000", address: "Uttara, Dhaka" },
        items: [{ description: "Winter jackets, imported", qty: "4", unitPrice: "1800" }],
        charges: [{ label: "Delivery", amount: "150" }],
        discount: "0",
        paid: "0",
        notes: "Thank you for your business.",
        accounts: [{ provider: "bKash", accountName: "Demo Portal Customer", accountNumber: PORTAL_PHONE, notes: "" }],
      },
    },
  });

  // Demo staff for the CS and China roles, then a few unread notifications for every role,
  // built from the same rules and templates the app uses.
  await staffUser("cs.demo@silktrack.test", "Demo CS", "CS", "Asia/Dhaka");
  await staffUser("china.demo@silktrack.test", "Demo China", "PURCHASE", "Asia/Shanghai");
  await staffUser("admin.demo@silktrack.test", "Demo Admin", "ADMIN", "Asia/Dhaka");

  // Organization details and payment accounts for PDFs (Settings → Organization / Payment information).
  const org = await prisma.setting.findUnique({ where: { key: "organization" } });
  const orgValue = (org?.value ?? {}) as Record<string, unknown>;
  if (!orgValue.phone) {
    const value = { name: "SilkTrack", tagline: "China sourcing & shipping to your door", phone: "+880 1700-000000", email: "hello@silktrack.test", website: "www.silktrack.test", address: "House 12, Road 5, Gulshan-1\nDhaka 1212, Bangladesh", logo: orgValue.logo ?? null };
    await prisma.setting.upsert({ where: { key: "organization" }, update: { value }, create: { key: "organization", value, description: "Organization details for PDFs" } });
  }
  if ((await prisma.paymentAccount.count()) === 0) {
    await prisma.paymentAccount.createMany({
      data: [
        { type: "BANK", providerName: "Dutch-Bangla Bank PLC", accountName: "SilkTrack Trading", accountNumber: "123.110.0045678", branch: "Gulshan", routingNumber: "090261726", sortOrder: 1, showOnPdf: true },
        { type: "MOBILE_BANKING", providerName: "bKash", accountName: "SilkTrack", accountNumber: "01700-000000", notes: "Merchant – choose Payment and use your order number as reference", sortOrder: 2, showOnPdf: true },
        { type: "MOBILE_BANKING", providerName: "Nagad", accountName: "SilkTrack", accountNumber: "01800-000000", notes: "Hidden from PDFs (demo of the toggle)", sortOrder: 3, showOnPdf: false },
      ],
    });
  }
  const staff = await prisma.user.findMany({ where: { active: true }, select: { id: true, role: true } });
  const accounts = await prisma.portalAccount.findMany({ where: { status: "ACTIVE" }, select: { id: true, kind: true, customerId: true } });
  const agentCustomerIds = new Set((await prisma.customer.findMany({ where: { agentAccountId: agent.id }, select: { id: true } })).map((c) => c.id));
  const no = (p: string, n: number) => `${p}-${String(n).padStart(6, "0")}`;
  const note = async (type: EventType, d: Data, about: { orderId?: string; shippingOrderId?: string; customerId?: string }, staffLink: string, portalLink: string) => {
    const rule = RULES[type];
    const event = await prisma.notificationEvent.create({ data: { type, data: d, orderId: about.orderId, shippingOrderId: about.shippingOrderId, customerId: about.customerId } });
    const rows = [
      ...staff.filter((u) => (rule.roles as Role[]).includes(u.role)).map((u) => ({ ...render(type, d, "staff"), userId: u.id, link: staffLink })),
      ...(rule.customer && about.customerId
        ? accounts
            .filter((a) => (a.kind === "CUSTOMER" && a.customerId === about.customerId) || (a.kind === "AGENT" && a.id === agent.id && agentCustomerIds.has(about.customerId!)))
            .map((a) => ({ ...render(type, d, "customer", a.kind === "AGENT"), portalAccountId: a.id, link: portalLink }))
        : []),
    ];
    await prisma.notification.createMany({ data: rows.map((r) => ({ ...r, channel: "IN_APP" as const, type, eventId: event.id, status: "SENT" as const, orderId: about.orderId })) });
  };
  const ord = (o: { id: string; number: number; customerId: string }) => ({ about: { orderId: o.id, customerId: o.customerId }, staff: `/requests/${o.id}`, portal: `/portal/requests/${o.id}`, ref: no("REQ", o.number) });
  const shp = (o: { id: string; number: number; customerId: string }) => ({ about: { shippingOrderId: o.id, customerId: o.customerId }, staff: `/shipping-orders/${o.id}`, portal: `/portal/shipping/${o.id}`, ref: no("SHO", o.number) });
  const a = ord(buyPortal);
  const b = shp(shipPortal);
  const c = ord(buyStaff);
  await note("BUY_REQUEST_NEW", { ref: a.ref, customer: portalCustomer.name, items: 1, method: "air" }, a.about, a.staff, a.portal);
  await note("QUOTE_SENT", { ref: a.ref, validUntil: "2099-01-01" }, a.about, a.staff, a.portal);
  await note("QA_FAILED", { ref: b.ref, notes: "Demo: one sneaker has a scuff mark", customer: portalCustomer.name }, b.about, b.staff, b.portal);
  await note("SHIPMENT_DEPARTED", { ref: b.ref, shipment: "SHP-DEMO-A" }, b.about, b.staff, b.portal);
  await note("PAYMENT_SUBMITTED", { ref: "PS-DEMO", amount: "800.00", method: "nagad", reference: `${ref}N`, target: b.ref }, {}, "/payments-to-verify", "/portal");
  await note("ISSUE_REPORTED", { ref: c.ref, problem: "Demo: carton arrived crushed", where: "China warehouse" }, c.about, `/issues?id=${issue.id}`, c.portal);
  await note("PRICE_APPROVAL_RESULT", { ref: c.ref, approved: true, purchase: "PUR-DEMO" }, c.about, c.staff, c.portal);
  await note("QUOTE_SUBMITTED", { ref: c.ref, estimate: "EST-DEMO v1", totalRmb: "420.00" }, c.about, c.staff, c.portal);
  const agentOrder = await prisma.order.findFirst({ where: { placedByAccountId: agent.id }, orderBy: { requestedAt: "desc" }, select: { id: true, number: true, customerId: true } });
  if (agentOrder) {
    const g = ord(agentOrder);
    await note("PURCHASED", { ref: g.ref, purchase: "PUR-DEMO", customer: "Demo Agent Customer" }, g.about, g.staff, g.portal);
  }

  console.log("Demo data added: 4 Buy for Me (2 by the agent), 2 Ship for Me, 2 payments to confirm, 1 open issue.");
  console.log(`Customer portal login: mobile ${PORTAL_PHONE} / password ${PORTAL_PASSWORD}`);
  console.log(`Agent portal login:    mobile ${AGENT_PHONE} / password ${AGENT_PASSWORD}`);
  console.log(`CS login:    cs.demo@silktrack.test / ${STAFF_PASSWORD}`);
  console.log(`China login: china.demo@silktrack.test / ${STAFF_PASSWORD}`);
  console.log(`Admin login: admin.demo@silktrack.test / ${STAFF_PASSWORD} (local demo only)`);
  console.log("Every role now has a few unread demo notifications.");
  console.log(`Demo customer's ${"SHO-" + String(shipPortal.number).padStart(6, "0")} is in shipment ${shipment.code}; their Buy for Me requests are not in a shipment yet.`);
  console.log(`Invoiced demo order SHO-${String(invoiced.number).padStart(6, "0")}: download its invoice / receipt PDFs from the staff app.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
