import Link from "next/link";
import type { ReactNode } from "react";
import type { DocumentBranding } from "@/server/organization";

/**
 * Shared PDF pieces (quotation, invoices, payment receipts). Everything about
 * the organization and its bank details comes from Settings via
 * getDocumentBranding() – nothing is hard-coded here.
 */
export function DocumentHeader({ branding, children }: { branding: DocumentBranding; children: ReactNode }) {
  const { org, logoUrl } = branding;
  const contact = [org.phone, org.email, org.website].filter(Boolean).join(" · ");
  return (
    <>
      {!org.name && (
        <p className="no-print mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Organization details are not set yet.{" "}
          <Link href="/settings/organization" className="font-semibold underline">
            Add them in Settings
          </Link>
          .
        </p>
      )}
      <div className="flex items-start justify-between gap-6 border-b-2 border-blue-700 pb-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- printed document; served by /api/org/logo
            <img src={logoUrl} alt={org.name || "Logo"} className="max-h-16 max-w-40 object-contain" />
          )}
          <div>
            {org.name && <div className="text-2xl font-bold text-blue-700">{org.name}</div>}
            {org.tagline && <div className="text-xs text-gray-500">{org.tagline}</div>}
            {org.address && <div className="mt-1 whitespace-pre-line text-xs text-gray-600">{org.address}</div>}
            {contact && <div className="text-xs text-gray-600">{contact}</div>}
          </div>
        </div>
        <div className="shrink-0 text-right">{children}</div>
      </div>
    </>
  );
}

const TYPE = { BANK: "Bank", MOBILE_BANKING: "Mobile banking", OTHER: "Other" } as const;

/** "How to pay" box with the accounts Admin marked "Show on PDFs". Renders nothing when there are none. */
export function PaymentDetails({ branding, reference, intro }: { branding: DocumentBranding; reference?: string; intro?: string }) {
  if (!branding.accounts.length) return null;
  return (
    <div className="mt-6 break-inside-avoid rounded border border-gray-200 p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-gray-500">How to pay</div>
      {intro && <p className="mb-2 text-xs text-gray-600">{intro}</p>}
      <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
        {branding.accounts.map((a) => (
          <div key={a.id} className="text-xs">
            <div className="font-semibold text-gray-900">
              {a.providerName} <span className="font-normal text-gray-500">({TYPE[a.type]})</span>
            </div>
            <div>Account name: {a.accountName}</div>
            <div>
              Account no.: <span className="font-medium tabular-nums">{a.accountNumber}</span>
            </div>
            {a.branch && <div>Branch: {a.branch}</div>}
            {a.routingNumber && <div>Routing no.: {a.routingNumber}</div>}
            {a.notes && <div className="text-gray-500">{a.notes}</div>}
          </div>
        ))}
      </div>
      {reference && <p className="mt-2 text-xs text-gray-600">Please use {reference} as the payment reference.</p>}
    </div>
  );
}
