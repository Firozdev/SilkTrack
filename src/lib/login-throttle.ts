// Login lockout: after MAX_FAILURES wrong passwords for the same email from the
// same IP, block that pair for LOCK_MS. Keyed by email + IP so an attacker
// cannot lock a real user out from elsewhere. Kept in memory (one app
// container); a restart clears it.

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

type Entry = { failures: number; lockedUntil: number; lastFailure: number };

const entries = new Map<string, Entry>();

function key(email: string, ip: string) {
  return `${email.trim().toLowerCase()}|${ip}`;
}

/** Minutes left on the lock (rounded up), or 0 when not locked. */
export function lockedMinutes(email: string, ip: string, now = Date.now()): number {
  const e = entries.get(key(email, ip));
  if (!e || e.lockedUntil <= now) return 0;
  return Math.ceil((e.lockedUntil - now) / 60_000);
}

export function recordFailure(email: string, ip: string, now = Date.now()) {
  prune(now);
  const k = key(email, ip);
  const e = entries.get(k);
  // A lock that has run out starts a fresh count.
  const failures = e && e.lockedUntil <= now && e.lockedUntil !== 0 ? 1 : (e?.failures ?? 0) + 1;
  entries.set(k, {
    failures: failures >= MAX_FAILURES ? 0 : failures,
    lockedUntil: failures >= MAX_FAILURES ? now + LOCK_MS : 0,
    lastFailure: now,
  });
}

export function recordSuccess(email: string, ip: string) {
  entries.delete(key(email, ip));
}

/** Forget old entries so the map cannot grow without bound. */
function prune(now: number) {
  if (entries.size < 10_000) return;
  for (const [k, e] of entries) {
    if (e.lockedUntil <= now && now - e.lastFailure > LOCK_MS) entries.delete(k);
  }
}

/** Client IP as set by Caddy / the tunnel (first X-Forwarded-For entry). */
export function clientIp(request: Request | undefined): string {
  const fwd = request?.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || "unknown";
}

/** Test helper. */
export function resetLoginThrottle() {
  entries.clear();
}
