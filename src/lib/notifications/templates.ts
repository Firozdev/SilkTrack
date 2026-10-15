import type { EventType } from "./rules";

/**
 * Notification texts, in one place (English now; add a Bangla set later).
 * `d.ref` is the record number (e.g. REQ-000123); the panel turns it into a
 * link. Customer-side texts never mention costs, rates, margins or suppliers.
 */
export type Data = Record<string, string | number | boolean | null | undefined>;
export type Audience = "staff" | "customer";
export type Text = { title: string; body: string };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const opt = (prefix: string, v: unknown) => (v ? `${prefix}${s(v)}` : "");

type T = (d: Data, a: Audience) => Text;

export const TEMPLATES: Record<EventType, T> = {
  BUY_REQUEST_NEW: (d, a) =>
    a === "customer"
      ? { title: `Request ${s(d.ref)} received`, body: "Thank you! Our China team is preparing your quotation." }
      : { title: `${d.bulk ? "Estimate requested" : "New Buy for Me request"}: ${s(d.ref)}`, body: `${s(d.customer)} · ${s(d.items)} product(s), ${s(d.method)} shipping${opt(" · placed by agent ", d.agent)}.` },
  SHIP_REQUEST_NEW: (d, a) =>
    a === "customer"
      ? { title: `Shipping order ${s(d.ref)} received`, body: "We will tell you when your parcels reach our China warehouse." }
      : { title: `New Ship for Me request: ${s(d.ref)}`, body: `${s(d.customer)} · ${s(d.items)} parcel(s) expected at the China warehouse${d.qa ? " – QA test requested" : ""}${opt(" · placed by agent ", d.agent)}.` },
  QA_REQUESTED: (d) => ({ title: `QA test to do: ${s(d.ref)}`, body: "Test the goods at the China warehouse and record the result before shipping." }),
  PORTAL_REQUEST_EDITED: (d) => ({ title: `Customer changed request ${s(d.ref)}`, body: "Check the updated products before quoting." }),
  PORTAL_REQUEST_CANCELLED: (d) => ({ title: `Customer cancelled ${s(d.ref)}`, body: s(d.reason) || "No reason given." }),
  PORTAL_SHIPPING_EDITED: (d) => ({ title: `Customer changed ${s(d.ref)}`, body: "Products / tracking were updated." }),
  PORTAL_SHIPPING_CANCELLED: (d) => ({ title: `Customer cancelled ${s(d.ref)}`, body: s(d.reason) || "No reason given." }),
  COMMENT_FROM_CHINA: (d) => ({ title: `New comment on ${s(d.ref)}`, body: s(d.text) }),
  COMMENT_FROM_BD: (d) => ({ title: `New comment on ${s(d.ref)}`, body: s(d.text) }),

  QUOTE_SUBMITTED: (d) => ({ title: `Quotation ready to send: ${s(d.ref)}`, body: `${s(d.estimate)} – total ¥${s(d.totalRmb)}. Add selling prices and send to the customer, or request a sample.` }),
  QUOTE_SENT: (d) => ({ title: `Quote ready for ${s(d.ref)}`, body: `Open the request to see the price and approve it${opt(". Valid until ", d.validUntil)}.` }),
  QUOTE_DECIDED: (d) => ({ title: `Quote ${d.approved ? "approved" : "declined"} by customer: ${s(d.ref)}`, body: d.approved ? `${s(d.estimate)} – collect the advance payment.` : `${s(d.estimate)}${opt(" – ", d.reason)}` }),
  QUOTE_REVISION_REQUESTED: (d) => ({ title: `Quotation revision requested: ${s(d.ref)}`, body: s(d.reason) || `Update ${s(d.estimate)}.` }),
  APPROVED_FOR_PURCHASE: (d) => ({ title: `Customer approved: ${s(d.ref)}`, body: "In the purchase queue – request the upfront payment from the BD team." }),
  UPFRONT_PAYMENT_REQUESTED: (d) => ({ title: `Upfront payment requested: ${s(d.ref)}`, body: s(d.note) || "Collect the advance from the customer and record it to release the purchase." }),
  PURCHASE_RELEASED: (d) => ({ title: `Payment confirmed – ready to purchase: ${s(d.ref)}`, body: "BD confirmed the upfront payment was received." }),

  PRICE_APPROVAL_NEEDED: (d) => ({ title: `Price change needs approval: ${s(d.ref)}`, body: `Supplier price is more than ${s(d.pct)}% above the quote (${s(d.purchase)}).` }),
  PRICE_APPROVAL_RESULT: (d) => ({ title: `Price change ${d.approved ? "approved" : "rejected"}: ${s(d.ref)}`, body: d.approved ? `${s(d.purchase)} – you can go ahead and buy.` : `${s(d.purchase)} – do not buy at this price; mark the purchase as price changed.` }),
  PURCHASED: (d, a) => (a === "customer" ? { title: `${s(d.ref)} purchased in China`, body: "We bought your product. Next it travels to our China warehouse." } : { title: `Purchased: ${s(d.ref)}`, body: `${s(d.purchase)}${opt(" from ", d.supplier)}.` }),
  PURCHASE_PROBLEM: (d) => ({ title: `${s(d.ref)}: ${s(d.problem)}`, body: `${s(d.purchase)}${opt(" – ", d.note)}` }),

  RECEIVED_CHINA: (d, a) =>
    a === "customer" ? { title: `${s(d.ref)} received at our China warehouse`, body: "Your goods arrived safely and are being prepared for shipping." } : { title: `Received in China: ${s(d.ref)}`, body: s(d.detail) },
  QA_PASSED: (d) => ({ title: `${s(d.ref)} QA test passed`, body: s(d.notes) || "Your goods passed the QA test and are ready to ship." }),
  QA_FAILED: (d, a) =>
    a === "customer"
      ? { title: `${s(d.ref)} QA test failed`, body: `${s(d.notes) || "See the QA photos on the order."} We will contact you about what to do next.` }
      : { title: `QA failed: ${s(d.ref)}`, body: `${s(d.notes) || "See the QA photos."} Tell the China team to ship anyway, or put the order on hold.` },
  ASSIGNED_TO_SHIPMENT: (d) => ({ title: `${s(d.ref)} added to shipment ${s(d.shipment)}`, body: `It will leave China with shipment ${s(d.shipment)}.` }),

  SHIPMENT_DEPARTED: (d) => ({ title: `${s(d.ref)} left China`, body: `Shipment ${s(d.shipment)} has departed for Bangladesh.` }),
  SHIPMENT_IN_TRANSIT: (d) => ({ title: `${s(d.ref)} on the way to Bangladesh`, body: `Shipment ${s(d.shipment)} is in transit.` }),
  SHIPMENT_ARRIVED: (d) => ({ title: `${s(d.ref)} arrived in Bangladesh`, body: `${s(d.parcels)} parcel(s) to receive.` }),
  ARRIVED_BD: (d) => ({ title: `${s(d.ref)} arrived in Bangladesh`, body: "We will share the final bill and delivery details soon." }),
  CUSTOMS_CLEARED: (d) => ({ title: `${s(d.ref)} cleared customs`, body: `Shipment ${s(d.shipment)} cleared customs in Bangladesh.` }),

  INVOICE_READY: (d) => ({ title: `Invoice ready for ${s(d.ref)}`, body: `Total ৳${s(d.total)}. Open the order to see the bill and pay.` }),
  PAYMENT_SUBMITTED: (d) => ({ title: `Payment to verify: ${s(d.ref)}`, body: `৳${s(d.amount)} by ${s(d.method)} · ${s(d.reference)} for ${s(d.target)} – check it and approve in Payments to verify.` }),
  PAYMENT_CONFIRMED: (d, a) => (a === "customer" ? { title: `Payment received for ${s(d.ref)}`, body: `We confirmed your payment of ৳${s(d.amount)}. Thank you!` } : { title: `Payment confirmed: ${s(d.ref)}`, body: `৳${s(d.amount)} ${s(d.method)} (${s(d.kind)}).` }),
  READY_FOR_DELIVERY: (d) => ({ title: `${s(d.ref)} ready for home delivery`, body: "Fully paid – we will send it to your address soon." }),
  OUT_FOR_DELIVERY: (d) => ({ title: `${s(d.ref)} out for delivery`, body: s(d.how) || "On the way to your address." }),
  DELIVERED: (d) => ({ title: `${s(d.ref)} delivered`, body: "Please confirm in the portal that you received everything." }),
  CUSTOMER_CONFIRMED_RECEIPT: (d) => ({ title: `Received by customer: ${s(d.ref)}`, body: s(d.note) || "The customer confirmed they received the goods." }),
  CUSTOMER_PROBLEM_REPORTED: (d) => ({ title: `⚠ Problem reported: ${s(d.ref)}`, body: s(d.note) || "The customer reported a problem – contact them." }),

  ISSUE_REPORTED: (d, a) =>
    a === "customer" ? { title: `Problem found with ${s(d.ref)}`, body: `${s(d.problem)}. We are sorting it out and will update you.` } : { title: `Issue reported: ${s(d.ref)}`, body: `${s(d.problem)}${opt(" · ", d.where)}` },
  ISSUE_RESOLVED: (d, a) => (a === "customer" ? { title: `Problem with ${s(d.ref)} resolved`, body: s(d.resolution) || "The problem was resolved." } : { title: `${s(d.issue)} resolved (${s(d.ref)})`, body: s(d.resolution) }),

  SAMPLE_REQUESTED: (d) => ({ title: `Sample requested: ${s(d.ref)}`, body: `${s(d.detail)} – prepare the sample invoice.` }),
  SAMPLE_INVOICED: (d) => ({ title: `Sample invoice: ${s(d.ref)}`, body: `৳${s(d.total)}. ${d.paymentRequired ? "Collect payment from the customer and record it." : "China will buy the sample without waiting for payment."}` }),
  SAMPLE_PAID: (d) => ({ title: `Sample paid – buy now: ${s(d.ref)}`, body: s(d.detail) }),
  SAMPLE_PURCHASED: (d) => ({ title: `Sample purchased: ${s(d.ref)}`, body: s(d.detail) }),
  SAMPLE_SHIPPED: (d) => ({ title: `Sample on the way: ${s(d.ref)}`, body: s(d.how) }),
  SAMPLE_DELIVERED: (d) => ({ title: `Sample delivered: ${s(d.ref)}`, body: d.feedback ? `Customer feedback: ${s(d.feedback)}` : "Delivered to the customer." }),

  PORTAL_SIGNUP: (d) => ({ title: `Portal sign-up: ${s(d.name)}`, body: d.matches ? `${s(d.phone)} – same phone as ${s(d.matches)}. Check and approve in Customers.` : `${s(d.phone)} – approve in Customers.` }),
  AGENT_CUSTOMER_ADDED: (d) => ({ title: `Agent added a customer: ${s(d.ref)}`, body: `${s(d.name)} · ${s(d.phone)} – added by agent ${s(d.agent)}.` }),
  RATE_MISSING: (d) => ({ title: "Today's RMB → BDT rate is not entered", body: `Prices are using the last rate${opt(" from ", d.lastDate)}. Enter today's rate in Settings.` }),
};

/** Text for one recipient. Agents also see whose order it is. */
export function render(type: EventType, d: Data, a: Audience, forAgent = false): Text {
  const t = TEMPLATES[type](d, a);
  return forAgent && d.customer ? { title: t.title, body: `${t.body} (Customer: ${s(d.customer)})` } : t;
}

/** Short labels for the filter on the "All notifications" page. */
export const TYPE_LABEL: Record<EventType, string> = {
  BUY_REQUEST_NEW: "New Buy for Me request",
  SHIP_REQUEST_NEW: "New Ship for Me request",
  QA_REQUESTED: "QA test requested",
  PORTAL_REQUEST_EDITED: "Request changed by customer",
  PORTAL_REQUEST_CANCELLED: "Request cancelled by customer",
  PORTAL_SHIPPING_EDITED: "Shipping order changed by customer",
  PORTAL_SHIPPING_CANCELLED: "Shipping order cancelled by customer",
  COMMENT_FROM_CHINA: "Comment from China",
  COMMENT_FROM_BD: "Comment from BD",
  QUOTE_SUBMITTED: "Quotation ready to send",
  QUOTE_SENT: "Quote ready",
  QUOTE_DECIDED: "Quote approved / declined",
  QUOTE_REVISION_REQUESTED: "Quotation revision",
  APPROVED_FOR_PURCHASE: "Approved for purchase",
  UPFRONT_PAYMENT_REQUESTED: "Upfront payment requested",
  PURCHASE_RELEASED: "Purchase released",
  PRICE_APPROVAL_NEEDED: "Price change approval needed",
  PRICE_APPROVAL_RESULT: "Price change decision",
  PURCHASED: "Purchased in China",
  PURCHASE_PROBLEM: "Purchase problem",
  RECEIVED_CHINA: "Received at China warehouse",
  QA_PASSED: "QA passed",
  QA_FAILED: "QA failed",
  ASSIGNED_TO_SHIPMENT: "Added to a shipment",
  SHIPMENT_DEPARTED: "Shipment departed",
  SHIPMENT_IN_TRANSIT: "Shipment in transit",
  SHIPMENT_ARRIVED: "Shipment arrived in Bangladesh",
  ARRIVED_BD: "Arrived in Bangladesh",
  CUSTOMS_CLEARED: "Customs cleared",
  INVOICE_READY: "Invoice ready",
  PAYMENT_SUBMITTED: "Payment to verify",
  PAYMENT_CONFIRMED: "Payment confirmed",
  READY_FOR_DELIVERY: "Ready for delivery",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CUSTOMER_CONFIRMED_RECEIPT: "Customer confirmed receipt",
  CUSTOMER_PROBLEM_REPORTED: "Customer reported a problem",
  ISSUE_REPORTED: "Issue reported",
  ISSUE_RESOLVED: "Issue resolved",
  SAMPLE_REQUESTED: "Sample requested",
  SAMPLE_INVOICED: "Sample invoice",
  SAMPLE_PAID: "Sample paid",
  SAMPLE_PURCHASED: "Sample purchased",
  SAMPLE_SHIPPED: "Sample shipped",
  SAMPLE_DELIVERED: "Sample delivered",
  PORTAL_SIGNUP: "Portal sign-up",
  AGENT_CUSTOMER_ADDED: "Agent added a customer",
  RATE_MISSING: "Rate not entered",
};
