const HOLD_KEY = "zarelon_drop_holds_v1";
const HOLD_MS = 10 * 60 * 1000;

type HoldRecord = {
  user_id: string;
  drop_id: string;
  expires_at: number;
};

const read = (): HoldRecord[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HOLD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HoldRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.user_id === "string" &&
        typeof item.drop_id === "string" &&
        typeof item.expires_at === "number"
    );
  } catch {
    return [];
  }
};

const write = (records: HoldRecord[]) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(HOLD_KEY, JSON.stringify(records));
};

export const clearExpiredDropHolds = () => {
  const now = Date.now();
  const active = read().filter((item) => item.expires_at > now);
  write(active);
  return active;
};

export const startDropHold = (userId: string, dropId: string, durationMs = HOLD_MS) => {
  const now = Date.now();
  const expiresAt = now + Math.max(30_000, durationMs);
  const active = clearExpiredDropHolds().filter((item) => !(item.user_id === userId && item.drop_id === dropId));
  active.push({ user_id: userId, drop_id: dropId, expires_at: expiresAt });
  write(active);
  return expiresAt;
};

export const getDropHoldRemainingMs = (userId: string, dropId: string): number => {
  const now = Date.now();
  const hit = clearExpiredDropHolds().find((item) => item.user_id === userId && item.drop_id === dropId);
  if (!hit) return 0;
  return Math.max(0, hit.expires_at - now);
};

export const getUserDropHolds = (userId: string): HoldRecord[] => {
  return clearExpiredDropHolds().filter((item) => item.user_id === userId);
};

export const releaseDropHold = (userId: string, dropId: string) => {
  const next = clearExpiredDropHolds().filter((item) => !(item.user_id === userId && item.drop_id === dropId));
  write(next);
};

export const consumeExpiredDropHolds = (userId: string): HoldRecord[] => {
  const now = Date.now();
  const records = read();
  const expired = records.filter((item) => item.user_id === userId && item.expires_at <= now);
  if (!expired.length) return [];
  const active = records.filter((item) => !(item.user_id === userId && item.expires_at <= now));
  write(active);
  return expired;
};
