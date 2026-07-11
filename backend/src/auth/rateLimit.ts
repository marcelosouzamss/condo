type AttemptEntry = {
  failures: number;
  lockedUntil: number;
  lastAttempt: number;
};

const attempts = new Map<string, AttemptEntry>();

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

function attemptKey(ip: string, login: string): string {
  return `${ip}|${login.trim().toLowerCase()}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil <= now && now - entry.lastAttempt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export function checkLoginAllowed(
  ip: string,
  login: string,
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  pruneExpired(now);
  const entry = attempts.get(attemptKey(ip, login));
  if (!entry) {
    return { allowed: true };
  }
  if (entry.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }
  if (now - entry.lastAttempt > WINDOW_MS) {
    attempts.delete(attemptKey(ip, login));
    return { allowed: true };
  }
  return { allowed: true };
}

export function recordLoginFailure(ip: string, login: string): void {
  const key = attemptKey(ip, login);
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now - entry.lastAttempt > WINDOW_MS) {
    entry = { failures: 0, lockedUntil: 0, lastAttempt: now };
  }
  entry.failures += 1;
  entry.lastAttempt = now;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCK_MS;
  }
  attempts.set(key, entry);
}

export function clearLoginFailures(ip: string, login: string): void {
  attempts.delete(attemptKey(ip, login));
}
