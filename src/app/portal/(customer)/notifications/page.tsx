import { NotificationList } from "@/components/notification-list";
import { btnCls, inputCls } from "@/components/ui";
import { TYPE_LABEL } from "@/lib/notifications/templates";
import { requirePortalAccount } from "@/lib/portal-session";
import { listNotifications } from "@/server/notifications";
import { portalMarkAllReadAction, portalMarkReadAction } from "../../actions";
import { getDict } from "../../lang";

export default async function PortalNotificationsPage({ searchParams }: PageProps<"/portal/notifications">) {
  const acc = await requirePortalAccount();
  const { t } = await getDict();
  const sp = await searchParams;
  const unreadOnly = sp.show === "unread";
  const type = typeof sp.type === "string" && sp.type ? sp.type : undefined;
  const { items, types } = await listNotifications({ accountId: acc.id }, { unreadOnly, type });
  const labels = { notifications: t.notifications, markAllRead: t.markAllRead, viewAll: t.viewAll, empty: t.noNotifications, sound: t.sound, justNow: t.justNow, minAgo: t.minAgo, hAgo: t.hAgo, dAgo: t.dAgo };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.notifications}</h1>
        <form action={portalMarkAllReadAction}>
          <button className={btnCls}>{t.markAllRead}</button>
        </form>
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="show" defaultValue={unreadOnly ? "unread" : ""} className={`${inputCls} max-w-[9rem]`}>
          <option value="">{t.allItems}</option>
          <option value="unread">{t.unreadOnly}</option>
        </select>
        <select name="type" defaultValue={type ?? ""} className={`${inputCls} max-w-xs`}>
          <option value="">{t.allItems}</option>
          {types.map((x) => (
            <option key={x} value={x}>
              {TYPE_LABEL[x as keyof typeof TYPE_LABEL] ?? x}
            </option>
          ))}
        </select>
        <button className={btnCls}>{t.filter}</button>
      </form>
      <NotificationList key={`${unreadOnly}-${type}`} items={items} labels={labels} markRead={portalMarkReadAction} />
    </>
  );
}
