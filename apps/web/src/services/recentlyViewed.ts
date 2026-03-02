const KEY = "zarelon_recently_viewed";
const MAX_ITEMS = 8;

const readRaw = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

const writeRaw = (ids: string[]) => {
  localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX_ITEMS)));
};

export const pushRecentlyViewed = (productId: string) => {
  const current = readRaw().filter((id) => id !== productId);
  writeRaw([productId, ...current]);
};

export const getRecentlyViewedIds = (): string[] => readRaw();
