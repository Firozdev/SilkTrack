import type { Lang } from "./i18n";

/** Customer-facing wording for statuses shown in the portal. */
const LABELS: Record<string, [en: string, bn: string]> = {
  // Requests / orders
  REQUESTED: ["Request received", "অনুরোধ পাওয়া গেছে"],
  QUOTED: ["Quote ready", "কোটেশন তৈরি"],
  APPROVED: ["Approved", "অনুমোদিত"],
  PURCHASED: ["Purchased in China", "চীনে কেনা হয়েছে"],
  AT_CHINA_WAREHOUSE: ["At our China warehouse", "চীনের ওয়্যারহাউসে আছে"],
  IN_SHIPMENT: ["Packed for shipping", "শিপমেন্টের জন্য প্রস্তুত"],
  IN_TRANSIT: ["On the way to Bangladesh", "বাংলাদেশের পথে"],
  ARRIVED_BD: ["Arrived in Bangladesh", "বাংলাদেশে পৌঁছেছে"],
  OUT_FOR_DELIVERY: ["Out for delivery", "ডেলিভারির পথে"],
  DELIVERED: ["Delivered", "ডেলিভারি হয়েছে"],
  CANCELLED: ["Cancelled", "বাতিল"],
  ON_HOLD: ["On hold", "স্থগিত"],
  NEW: ["Checking prices", "দাম যাচাই চলছে"],
  SAMPLING: ["Sample in progress", "স্যাম্পল চলছে"],
  CUSTOMER_APPROVED: ["Approved", "অনুমোদিত"],
  REJECTED: ["Not going ahead", "বাতিল করা হয়েছে"],
  // Shipping service
  RECEIVED_CHINA: ["Received at our China warehouse", "চীনের ওয়্যারহাউসে পৌঁছেছে"],
  QA_DONE: ["Quality check done", "কোয়ালিটি চেক সম্পন্ন"],
  RECEIVED_BD: ["Arrived in Bangladesh", "বাংলাদেশে পৌঁছেছে"],
  INVOICED: ["Invoice ready", "ইনভয়েস তৈরি"],
  READY_FOR_DELIVERY: ["Paid – preparing delivery", "পরিশোধিত – ডেলিভারির প্রস্তুতি"],
  // Samples
  AWAITING_PAYMENT: ["Waiting for payment", "পেমেন্টের অপেক্ষায়"],
  PAID: ["Paid", "পরিশোধিত"],
  SHIPPED: ["On the way to Bangladesh", "বাংলাদেশের পথে"],
  // Shipments
  UPCOMING: ["Planned", "পরিকল্পিত"],
  OPEN: ["Loading", "লোড হচ্ছে"],
  CLOSED: ["Loading finished", "লোড শেষ"],
  DEPARTED: ["On the way to Bangladesh", "বাংলাদেশের পথে"],
  CUSTOMS_CLEARED: ["Customs cleared", "কাস্টমস সম্পন্ন"],
  COMPLETED: ["Completed", "সম্পন্ন"],
  // Quotes / invoices / payments / delivery
  SENT_TO_CUSTOMER: ["Waiting for your approval", "আপনার অনুমোদনের অপেক্ষায়"],
  ISSUED: ["Due", "বাকি"],
  PARTIALLY_PAID: ["Partly paid", "আংশিক পরিশোধিত"],
  ADVANCE: ["Advance", "অগ্রিম"],
  BALANCE: ["Balance", "বাকি পরিশোধ"],
  REFUND: ["Refund", "ফেরত"],
  SAMPLE: ["Sample", "স্যাম্পল"],
  SHIPPING_SERVICE: ["Shipping", "শিপিং"],
  PENDING: ["Pending", "অপেক্ষমাণ"],
  ASSIGNED: ["Courier assigned", "কুরিয়ার ঠিক হয়েছে"],
  FAILED: ["Delivery failed", "ডেলিভারি ব্যর্থ"],
  RETURNED: ["Returned", "ফেরত এসেছে"],
  // Misc enums
  AIR: ["Air", "এয়ার"],
  SEA: ["Sea", "সি"],
  CASH: ["Cash", "ক্যাশ"],
  BKASH: ["bKash", "বিকাশ"],
  NAGAD: ["Nagad", "নগদ"],
  ROCKET: ["Rocket", "রকেট"],
  BANK_TRANSFER: ["Bank transfer", "ব্যাংক ট্রান্সফার"],
  CARD: ["Card", "কার্ড"],
  OTHER: ["Other", "অন্যান্য"],
  PATHAO: ["Pathao", "পাঠাও"],
  STEADFAST: ["Steadfast", "স্টেডফাস্ট"],
  REDX: ["RedX", "রেডএক্স"],
  OWN_RIDER: ["Our rider", "আমাদের রাইডার"],
  WEEKLY_SHIPMENT: ["Weekly shipment", "সাপ্তাহিক শিপমেন্ট"],
  EXPRESS_COURIER: ["Express courier", "এক্সপ্রেস কুরিয়ার"],
  HAND_CARRY: ["Hand carry", "হ্যান্ড ক্যারি"],
  POST: ["Post", "পোস্ট"],
  DAMAGED: ["Damaged", "ক্ষতিগ্রস্ত"],
  WRONG_ITEM: ["Wrong item", "ভুল পণ্য"],
  SHORT: ["Short", "কম এসেছে"],
};

export function portalLabel(status: string, lang: Lang = "en"): string {
  const l = LABELS[status];
  if (l) return l[lang === "bn" ? 1 : 0];
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}
