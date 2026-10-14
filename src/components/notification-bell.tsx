"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bell with unread badge, dropdown, toast and chime – shared by staff and portal.
 * New notifications arrive by polling `feedUrl` every 20 s (simple, and works
 * through Caddy / the Cloudflare tunnel without long-lived connections).
 */
export type FeedItem = { id: string; type: string; title: string; body: string; link: string | null; ref: string | null; read: boolean; createdAt: string };
type Feed = { unread: number; latest: FeedItem[]; fresh: FeedItem[]; now: string };

export type BellLabels = {
  notifications: string;
  markAllRead: string;
  viewAll: string;
  empty: string;
  sound: string;
  justNow: string;
  minAgo: string; // "{n} min ago"
  hAgo: string; // "{n} h ago"
  dAgo: string; // "{n} d ago"
};

export const POLL_MS = 20_000;

export function timeAgo(iso: string, l: Pick<BellLabels, "justNow" | "minAgo" | "hAgo" | "dAgo">, now = Date.now()) {
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return l.justNow;
  if (min < 60) return l.minAgo.replace("{n}", String(min));
  if (min < 48 * 60) return l.hAgo.replace("{n}", String(Math.floor(min / 60)));
  return l.dAgo.replace("{n}", String(Math.floor(min / 1440)));
}

/** Title with the record number shown as a link (the whole row opens it too). */
export function Titled({ item }: { item: Pick<FeedItem, "title" | "ref" | "link"> }) {
  if (!item.ref || !item.link || !item.title.includes(item.ref)) return <>{item.title}</>;
  const [before, ...rest] = item.title.split(item.ref);
  return (
    <>
      {before}
      <span className="font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2">{item.ref}</span>
      {rest.join(item.ref)}
    </>
  );
}

// ── Sound: a short two-note chime made with Web Audio (no file to load). ──
// Browsers only allow audio after the user has interacted with the page, so the
// context is created on the first click / key press; until then we stay silent.
let ctx: AudioContext | null = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}
function chime() {
  try {
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch {
    // never let a sound problem break the page
  }
}

export function NotificationBell({
  feedUrl,
  viewAllHref,
  soundOn: initialSound,
  labels,
  markRead,
  markAllRead,
  setSound,
}: {
  feedUrl: string;
  viewAllHref: string;
  soundOn: boolean;
  labels: BellLabels;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  setSound: (on: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [toasts, setToasts] = useState<FeedItem[]>([]);
  const [soundOn, setSoundOn] = useState(initialSound);
  const [, tick] = useState(0);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const soundRef = useRef(initialSound);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const url = since.current ? `${feedUrl}?since=${encodeURIComponent(since.current)}` : feedUrl;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return;
      const f = (await res.json()) as Feed;
      const first = since.current === null;
      since.current = f.now;
      setUnread(f.unread);
      setItems(f.latest);
      const fresh = first ? [] : f.fresh.filter((n) => !seen.current.has(n.id));
      for (const n of [...f.latest, ...f.fresh]) seen.current.add(n.id);
      if (fresh.length) {
        setToasts((t) => [...t, ...fresh].slice(-3));
        if (soundRef.current) chime();
        for (const n of fresh) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 7000);
      }
      tick((x) => x + 1);
    } catch {
      // offline or signed out – try again next round
    }
  }, [feedUrl]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openItem(n: FeedItem) {
    setOpen(false);
    setToasts((t) => t.filter((x) => x.id !== n.id));
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await markRead(n.id).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markAllRead().catch(() => {});
  }

  async function toggleSound(on: boolean) {
    setSoundOn(on);
    soundRef.current = on;
    if (on) {
      unlockAudio();
      chime();
    }
    await setSound(on).catch(() => {});
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md px-2 py-1 text-gray-700 hover:bg-gray-100"
        aria-label={`${labels.notifications}: ${unread}`}
        aria-expanded={open}
      >
        🔔
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-semibold text-gray-800">{labels.notifications}</span>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-xs font-medium text-blue-700 hover:underline">
                {labels.markAllRead}
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-4 text-sm text-gray-400">{labels.empty}</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={`block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 ${n.read ? "" : "bg-blue-50/50"}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-blue-600"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block ${n.read ? "text-gray-700" : "font-medium text-gray-900"}`}>
                        <Titled item={n} />
                      </span>
                      {n.body && <span className="block truncate text-xs text-gray-500">{n.body}</span>}
                      <span className="block text-[11px] text-gray-400">{timeAgo(n.createdAt, labels)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs">
            <label className="flex items-center gap-1.5 text-gray-600">
              <input type="checkbox" checked={soundOn} onChange={(e) => toggleSound(e.target.checked)} />
              {labels.sound}
            </label>
            <Link href={viewAllHref} onClick={() => setOpen(false)} className="font-medium text-blue-700 hover:underline">
              {labels.viewAll} →
            </Link>
          </div>
        </div>
      )}

      {/* Toasts for notifications that arrived while the page was open */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => openItem(n)}
            className="pointer-events-auto rounded-lg border border-blue-200 bg-white p-3 text-left text-sm shadow-lg transition hover:border-blue-400"
          >
            <span className="block font-medium text-gray-900">
              🔔 <Titled item={n} />
            </span>
            {n.body && <span className="mt-0.5 block text-xs text-gray-600">{n.body}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
