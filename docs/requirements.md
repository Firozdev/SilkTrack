# China Sourcing & Shipment Management App — Requirements

## Overview

The app gives one centralized system to take a customer's product request in Bangladesh, buy it in China, consolidate it into a weekly shipment, and deliver it to the customer's home — with every cost tracked in RMB and BDT.

**Goals**

- One record per customer order, visible to Admin, the CS team, and the Purchase team, from request to doorstep.
- One daily RMB-to-BDT rate that every price, estimate, and invoice uses, so no one converts by hand.
- Weekly shipments that products are attached to as they arrive at the China warehouse, with weight and CBM rolled up automatically.
- Tracking at every leg: supplier to China warehouse, China to Bangladesh, and Bangladesh to the customer.

**In scope:** single-item requests, bulk orders with estimates, purchasing, China warehouse receiving, weekly shipment consolidation, rate management, tracking, Bangladesh delivery, and reporting.

**Out of scope for v1** (unless decided otherwise): payment gateway integration, customs clearance filing, and supplier marketplace scraping.

## User roles and permissions

Three people run the app in three roles: Admin, CS team (Bangladesh), and Purchase team (China, called the China team in the modules below). Only Admin can change the exchange rate.

| Role | Main responsibilities | Key permissions |
| --- | --- | --- |
| Admin | Set up users, settings, and charges; update the daily RMB-to-BDT rate; manage weekly shipments; record payments; receive shipments in Bangladesh; arrange home delivery; manage notifications | Full access, audit log, profit reports, BD receiving and delivery fields |
| CS team (Bangladesh) | Create product requests, quote customers, confirm orders, collect advance | Create and edit requests and quotes; view China cost |
| Purchase team (China) | Receive requests, prepare bulk estimates, purchase from suppliers, update RMB price, China tracking, weights, CBM, warehouse receiving | Edit purchase, estimate, receiving, and shipment fields; cannot see BDT selling price or profit |

## Order lifecycle

Single orders go straight to purchase; bulk orders first get an RMB estimate converted to BDT and approved by the customer.

Flow:

1. Product request (CS team, Bangladesh)
2. Bulk order? — Yes: Estimate & quote (RMB to BDT, China team) → Customer approves (advance paid). No: go straight to purchase.
3. Purchase in China (RMB cost + supplier tracking)
4. China warehouse receiving (weight, CBM, photos)
5. Attach to weekly shipment (open week)
6. China to Bangladesh (air or sea, tracked)
7. BD receiving (final invoice) — Admin
8. Home delivery (courier, COD balance) — Admin
9. Delivered (proof of delivery)

The daily RMB-to-BDT rate (Module 4) is used by every price along the way.

Order status runs: Requested → Quoted → Approved → Purchased → At China warehouse → In shipment → In transit → Arrived BD → Out for delivery → Delivered, plus Cancelled and On hold at any step.

## Module 1: Product Request

The CS team in Bangladesh creates a request; the system decides whether it is a single order or a bulk order and routes it to the China team.

**Request fields**

- Request ID (auto), date, created by
- Customer: name, phone, email, delivery address, district/area
- Product link(s) — 1688, Taobao, Alibaba, Tmall, or other
- Product name, image(s), variant (color, size, model), quantity
- Customer notes and special instructions
- Request type: Single / Bulk (auto-suggested by quantity or value threshold, editable)
- Shipping method preference: Air / Sea
- Target budget in BDT (optional)

**Functions**

- Duplicate-link check so the same product is not requested twice.
- Request statuses: New → Sent to China → Quoted → Customer approved / Rejected → Cancelled.
- Advance payment capture (amount, method, reference) before purchase is released.
  *Decision (2026-10-03):* once the customer approves, the lines appear in the China purchase queue immediately. The China team sends an **upfront payment request** to the BD team; BD collects it and confirms by recording the advance payment; only then can the China team buy.
- Multiple products under one order, each with its own line status.
- Comments and attachments thread between Bangladesh and China teams on each request.

## Module 2: China Purchasing

The China team picks up approved requests, buys from the supplier, and records the actual RMB cost and the supplier's domestic tracking number.

**Purchase fields**

- Purchase ID (auto), linked request and order line
- Supplier / shop name, platform, supplier order number
- Unit price (RMB), quantity, China domestic shipping (RMB), service charge (RMB), total (RMB)
- BDT equivalent — auto-calculated from the rate of the purchase date (see Module 4)
- Purchased by, purchase date, payment method used in China
- China internal tracking: courier name and tracking number from supplier to China warehouse
- Expected arrival date at China warehouse
- Order tracking URL (supplier order / logistics page)
- *Decision (2026-10-03):* "Purchase complete" requires the order tracking URL and the estimated receive date at the China warehouse.

**Functions**

- China queue: list of approved requests waiting for purchase, sortable by date and priority.
- Purchase statuses: Pending → Purchased → Shipped by supplier → Received at China warehouse; plus Out of stock, Price changed, Refund from supplier.
- Price-change alert: if actual RMB cost is higher than the quoted RMB cost by a set %, flag the order for Bangladesh team approval before buying.
- One supplier order can cover lines from several customer orders (split cost by line).
- Upload invoice/screenshot of the supplier order.

## Module 3: Bulk Order Estimates

For bulk requests, the China team prepares an RMB estimate, the system converts it to BDT at the day's rate, and the Bangladesh team sends the customer a quote to approve.

**Estimate fields**

- Estimate ID (auto), linked request, version number
- Line items: product, MOQ, quantity, unit price (RMB), line total (RMB)
- China costs (RMB): domestic shipping, packing, inspection/QC, sample cost, service fee
- Estimated net weight (kg), gross weight (kg), carton count, CBM
- International shipping estimate: rate per kg (air) or per CBM (sea), in BDT
- Exchange rate applied (pulled from Module 4, locked on the estimate)
- Totals: RMB subtotal, BDT product cost, BDT shipping, BDT margin/commission, BDT grand total
- Validity date of the estimate

**Functions**

- Estimate statuses: Draft → Submitted by China → Reviewed by BD → Sent to customer → Approved / Revised / Rejected.
- Revisions keep history (v1, v2, v3) so changes in price or rate are traceable.
- Generate a branded PDF quotation in BDT for the customer.
- On approval, convert the estimate into an order with purchase lines in one click.
- Expired estimates must be re-priced at the current rate before approval.

## Module 4: Exchange Rate Management (RMB to BDT)

One rate table, updated each day, is the only source of RMB-to-BDT conversion anywhere in the app.

**Fields**

- Effective date, rate (1 RMB = X BDT), updated by, updated at, note
- Optional separate rates: buying rate (what the company pays) and selling rate (what the customer is charged)

**Rules**

- Only Admin can add or edit a rate; every change is logged.
- If no rate is entered for today, the app uses the last rate and shows a warning banner on every screen until it is updated.
- Each purchase, estimate, and invoice stores the rate used at that moment, so later rate changes do not alter past records.
- Rate history view and chart to see the trend over weeks and months.
- Optional: notify Admin each morning if today's rate has not been entered.

## Module 5: China Warehouse Receiving

When a parcel reaches the China warehouse, the China team checks it, records its weight and CBM, and attaches it to a weekly shipment.

**Receiving fields**

- Receiving ID (auto), linked purchase(s) and customer order(s)
- Received date, received by, matched by supplier tracking number
- Quantity received vs. ordered; condition (OK / Damaged / Wrong item / Short)
- Photos of the product and package
- Package/carton count and carton label / mark
- Net weight (kg), gross weight (kg)
- Dimensions L × W × H (cm) per carton, with CBM auto-calculated
- Assigned shipment (see Module 6)

CBM per carton = (L × W × H in cm) / 1,000,000

**Functions**

- Scan or search by supplier tracking number to find the matching purchase fast.
- Partial receiving: an order line can be received in more than one parcel.
- Issue handling: damaged, wrong, or missing items open a ticket back to the purchaser and to the BD team.
- Optional repacking: merge several parcels into one carton, with new weight and CBM.
- On save, the item becomes "Ready to ship" and appears in the list for the running or upcoming shipment.

## Module 6: Weekly Shipment Management

A shipment is created for each week in advance; received items are attached to the running or next upcoming shipment, and its totals roll up automatically.

**Shipment fields**

- Shipment ID / code (e.g. SHP-2026-W40), week number, method (Air / Sea)
- Cut-off date (last day to add items), planned departure date, ETA in Bangladesh
- Forwarder / cargo agent, master tracking number (AWB / B/L / container no.)
- Totals (auto): item count, carton count, net weight, gross weight, CBM
- Chargeable weight and freight cost (BDT or RMB) for the whole shipment
- Status: Upcoming → Open (accepting items) → Closed (cut-off passed) → Departed → In transit → Arrived BD → Customs cleared → Completed

**Rules for attaching items**

- When an item is received in China, the system suggests the current Open shipment of the matching method (Air / Sea).
- If the Open shipment has passed cut-off, the item goes to the next Upcoming shipment.
- The China team can move an item between shipments until the shipment is Closed.
- Optional capacity limit per shipment (max kg or CBM) with a warning when exceeded.
- Auto-create next week's shipment when the current one closes.

**Cost allocation**

- Shipment freight is split across the items in it by gross weight (air) or CBM (sea), so each customer order shows its share of shipping cost.
- Packing list and manifest export (PDF / Excel) per shipment, grouped by customer.

## Module 7: Tracking

Every order line carries three tracking legs, and the customer sees one simple timeline built from them.

| Leg | Updated by | What is tracked |
| --- | --- | --- |
| 1. Supplier → China warehouse | China team | Courier, tracking number, shipped date, received date |
| 2. China → Bangladesh | China team / Admin | Shipment code, master tracking (AWB / B/L), departure, ETA, arrival, customs |
| 3. Bangladesh → customer | Admin | Courier (e.g. Pathao, Steadfast, RedX, own rider), tracking number, delivered date, proof of delivery |

**Functions**

- Updating a shipment's status updates every order line inside it at once.
- Timeline view per order with date and user for each status change.
- Tracking status Admin can send to the customer by SMS or WhatsApp.
- Delay flag when an item passes its expected date for a leg.

## Module 8: Bangladesh Receiving & Home Delivery

When a shipment arrives, Admin checks each carton against the manifest, calculates the customer's final bill, and dispatches to the home address.

**Functions**

- Receive shipment against the packing list; mark each item Received / Missing / Damaged.
- Final weight check in Bangladesh; if it differs from China weight beyond a set tolerance, flag for review.
- Final invoice per customer order: product cost (BDT), China charges, international shipping share, local delivery charge, minus advance paid = balance due.
- Customer notification: "Arrived in Bangladesh" with balance amount and payment options.
- Dispatch: assign courier or rider, record tracking number, cash-on-delivery amount.
- Delivery confirmation with date, receiver name, and photo or signature.
- Returns and claims: record issue, decision (refund / replace / credit), and amount.

## Notifications, dashboards and reports

**Notifications** (managed by Admin; in-app, plus SMS / WhatsApp / email for customers)

- China team: new request, estimate requested, price-change approval result.
- CS team: estimate ready, purchase done, item received in China, issue reported.
- Admin: today's rate missing, payment due, shipment arrived in BD, balance unpaid after delivery.
- Customer: quote ready, order confirmed, purchased, shipped from China, arrived in BD, out for delivery, delivered.

**Dashboards**

- Bangladesh: open requests, pending quotes, orders by status, balances to collect.
- China: purchase queue, items awaiting arrival, items ready to ship, current shipment weight/CBM vs. capacity.
- Management: orders and revenue this week/month, profit by order and by shipment, average lead time per leg.

**Reports**

- Order profitability (selling price vs. RMB cost × rate + shipping share)
- Shipment summary and manifest (weight, CBM, cost, items per customer)
- Exchange rate history
- Customer ledger (advance, invoices, payments, balance)
- Supplier purchase history (RMB spend per supplier)
- Delay and issue report (damaged, missing, late legs)

## Non-functional requirements

- **Languages:** English and Bangla for the BD team and customers; Simplified Chinese labels for the China team screens.
- **Mobile-friendly:** China warehouse receiving and BD delivery must work on a phone, including photo upload and barcode/QR scan.
- **Currencies:** store RMB and BDT side by side with the rate used; never overwrite historical converted values.
- **Audit trail:** log who changed price, rate, weight, CBM, status, and when.
- **Access control:** role-based; the China team does not see customer selling price or profit unless allowed.
- **Labels:** print carton labels with QR code (order ID, customer code, shipment code).
- **Integrations (phase 2+):** SMS/WhatsApp gateway, BD courier APIs, accounting export.
- **Data import/export:** Excel import for bulk line items; Excel/PDF export for all lists and reports.
- **Backup and uptime:** daily backups; teams in two time zones (China UTC+8, Bangladesh UTC+6) see dates in their own time zone.

## Suggested phasing

| Phase | Scope |
| --- | --- |
| Phase 1 — Core | Product request, China purchasing, exchange rate, China receiving, weekly shipments, basic tracking, roles |
| Phase 2 — Money & customer | Bulk estimates with PDF quotes, invoices and payments, cost allocation, customer notifications |
| Phase 3 — Scale | Courier API integrations, dashboards and profit reports, QR labels and scanning |
