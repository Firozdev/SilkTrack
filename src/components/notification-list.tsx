"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Titled, timeAgo, type BellLabels, type FeedItem } from "./notification-bell";

/** Full list on the "All notifications" page; clicking a row marks it read and opens the record. */
export function NotificationList({ items: initial, labels, markRead }: { items: FeedItem[]; labels: BellLabels; markRead: (id: string) => Promise<void> }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  if (!items.length) return <p className="px-1 py-4 text-sm text-gray-400">{labels.empty}</p>;
  async function open(n: FeedItem) {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      await markRead(n.id).catch(() => {});
    }
    if (n.link) router.push(n.link);
    else router.refresh();
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {items.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => open(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left text-sm hover:bg-blue-50 ${n.read ? "" : "bg-blue-50/50"}`}>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-gray-200" : "bg-blue-600"}`} aria-label={n.read ? "read" : "unread"} />
            <span className="min-w-0 flex-1">
              <span className={`block ${n.read ? "text-gray-700" : "font-medium text-gray-900"}`}>
                <Titled item={n} />
              </span>
              {n.body && <span className="block text-gray-500">{n.body}</span>}
            </span>
            <span className="whitespace-nowrap text-xs text-gray-400">{timeAgo(n.createdAt, labels)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
