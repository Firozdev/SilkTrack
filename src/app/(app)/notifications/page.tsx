import { ActionForm } from "@/components/action-form";
import { NotificationList } from "@/components/notification-list";
import { PageHeader, btnCls, inputCls } from "@/components/ui";
import { TYPE_LABEL } from "@/lib/notifications/templates";
import { requireUser } from "@/lib/session";
import { listNotifications } from "@/server/notifications";
import { markReadAction } from "./actions";
import { markAllFormAction } from "./form-actions";

const LABELS = { notifications: "Notifications", markAllRead: "Mark all as read", viewAll: "View all", empty: "Nothing here.", sound: "Sound", justNow: "just now", minAgo: "{n} min ago", hAgo: "{n} h ago", dAgo: "{n} d ago" };

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const user = await requireUser();
  const sp = await searchParams;
  const unreadOnly = sp.show === "unread";
  const type = typeof sp.type === "string" && sp.type ? sp.type : undefined;
  const { items, types } = await listNotifications({ userId: user.id }, { unreadOnly, type });
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Only your own notifications. Click one to open its record."
        actions={
          <ActionForm action={markAllFormAction} submitLabel="Mark all as read" variant="default" inline>
            {null}
          </ActionForm>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="show" defaultValue={unreadOnly ? "unread" : ""} className={`${inputCls} max-w-[9rem]`}>
          <option value="">All</option>
          <option value="unread">Unread</option>
        </select>
        <select name="type" defaultValue={type ?? ""} className={`${inputCls} max-w-xs`}>
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t as keyof typeof TYPE_LABEL] ?? t.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        <button className={btnCls}>Filter</button>
      </form>
      <NotificationList key={`${unreadOnly}-${type}`} items={items} labels={LABELS} markRead={markReadAction} />
    </>
  );
}
