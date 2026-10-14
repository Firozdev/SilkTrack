import { ActionForm } from "@/components/action-form";
import { Badge, Card, Dl, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { normalizeBdPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { approveAction, disableAction, inviteAction, rejectAction, resetLinkAction } from "../portal-actions";
import { PORTAL_BADGE, PORTAL_LABEL } from "../portal-labels";

/** The customer's portal login: status and the actions that fit it. */
export async function PortalPanel({ customer, tz }: { customer: { id: string; phone: string; source: "STAFF" | "PORTAL" }; tz: string }) {
  const accounts = await prisma.portalAccount.findMany({
    where: { customerId: customer.id },
    orderBy: { updatedAt: "desc" },
    include: { reviewedBy: { select: { name: true } }, invitedBy: { select: { name: true } } },
  });
  const acc = accounts.find((a) => a.status !== "REJECTED") ?? accounts[0];
  const phoneOk = !!normalizeBdPhone(customer.phone);
  const hid = acc ? <input type="hidden" name="id" value={acc.id} /> : null;
  const invite = (label: string) => (
    <ActionForm action={inviteAction} submitLabel={label} variant={label.startsWith("Resend") ? "default" : "primary"} inline>
      <input type="hidden" name="customerId" value={customer.id} />
    </ActionForm>
  );

  return (
    <Card title="Customer portal" actions={acc && <Badge value={PORTAL_BADGE[acc.status]} label={PORTAL_LABEL[acc.status]} />}>
      <Dl
        items={[
          ["Joined via", customer.source === "PORTAL" ? "🌐 Portal sign-up" : "Added by staff"],
          ["Login phone", acc?.phone ?? "—"],
          ...(acc?.invitedAt ? ([["Invited", `${fmtDateTime(acc.invitedAt, tz)}${acc.invitedBy ? ` · ${acc.invitedBy.name}` : ""}`]] as [string, string][]) : []),
          ...(acc?.reviewedAt && acc.status !== "INVITED" ? ([[acc.status === "REJECTED" ? "Rejected" : "Activated", `${fmtDateTime(acc.reviewedAt, tz)}${acc.reviewedBy ? ` · ${acc.reviewedBy.name}` : ""}`]] as [string, string][]) : []),
          ...(acc?.rejectReason ? ([["Reason", acc.rejectReason]] as [string, string][]) : []),
          ["Last login", acc?.lastLoginAt ? fmtDateTime(acc.lastLoginAt, tz) : "never"],
        ]}
      />
      <div className="mt-3 space-y-2">
        {!acc || acc.status === "REJECTED" ? (
          phoneOk ? (
            <>
              <p className="text-xs text-gray-500">Invite them to track their purchases, shipments and bills online. They log in with {customer.phone}.</p>
              {invite("Invite to portal")}
            </>
          ) : (
            <p className="text-xs text-red-700">The phone number isn&apos;t a valid Bangladesh mobile – correct it before inviting.</p>
          )
        ) : acc.status === "INVITED" ? (
          <>
            <p className="text-xs text-gray-500">Waiting for them to open the link and set a password. Resending makes the old link stop working.</p>
            {invite("Resend invitation")}
          </>
        ) : acc.status === "PENDING" ? (
          <div className="flex flex-wrap gap-3">
            <ActionForm action={approveAction} submitLabel="Approve" inline>
              {hid}
            </ActionForm>
            <ActionForm action={rejectAction} submitLabel="Reject" variant="danger" inline>
              {hid}
              <input name="reason" required placeholder="Reason (they see it)" className={`${inputCls} max-w-[12rem]`} />
            </ActionForm>
          </div>
        ) : acc.status === "ACTIVE" ? (
          <div className="flex flex-wrap gap-3">
            <ActionForm action={resetLinkAction} submitLabel="Create password reset link" variant="default" inline>
              {hid}
            </ActionForm>
            <ActionForm action={disableAction} submitLabel="Disable" variant="danger" inline confirm="Disable this login? The customer is logged out at once.">
              {hid}
              <input type="hidden" name="disabled" value="yes" />
            </ActionForm>
          </div>
        ) : (
          <ActionForm action={disableAction} submitLabel="Enable" variant="default" inline>
            {hid}
            <input type="hidden" name="disabled" value="no" />
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
