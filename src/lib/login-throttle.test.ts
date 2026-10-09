import { beforeEach, describe, expect, it } from "vitest";
import { LOCK_MS, MAX_FAILURES, clientIp, lockedMinutes, recordFailure, recordSuccess, resetLoginThrottle } from "./login-throttle";

const IP = "203.0.113.5";

describe("login throttle", () => {
  beforeEach(() => resetLoginThrottle());

  it("locks after 5 failures for 15 minutes", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("a@x.com", IP, t);
    expect(lockedMinutes("a@x.com", IP, t)).toBe(0);
    recordFailure("a@x.com", IP, t);
    expect(lockedMinutes("a@x.com", IP, t)).toBe(15);
    expect(lockedMinutes("a@x.com", IP, t + LOCK_MS - 1)).toBe(1);
    expect(lockedMinutes("a@x.com", IP, t + LOCK_MS)).toBe(0);
  });

  it("starts a fresh count after the lock expires", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("a@x.com", IP, t);
    const after = t + LOCK_MS;
    recordFailure("a@x.com", IP, after);
    expect(lockedMinutes("a@x.com", IP, after)).toBe(0);
  });

  it("does not lock the same email from another IP", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure("a@x.com", IP);
    expect(lockedMinutes("a@x.com", IP)).toBeGreaterThan(0);
    expect(lockedMinutes("a@x.com", "198.51.100.7")).toBe(0);
  });

  it("treats email case-insensitively and resets on success", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure("A@X.com", IP);
    recordSuccess("a@x.com", IP);
    recordFailure("a@x.com", IP);
    expect(lockedMinutes("a@x.com", IP)).toBe(0);
  });

  it("reads the client IP from X-Forwarded-For", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.2" } });
    expect(clientIp(req)).toBe("203.0.113.5");
    expect(clientIp(undefined)).toBe("unknown");
  });
});
