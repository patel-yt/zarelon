const buckets = new Map<string, number[]>();

export const allowBurstRequest = (key: string, maxPerSec = 3): boolean => {
  const now = Date.now();
  const oneSecAgo = now - 1000;
  const list = (buckets.get(key) ?? []).filter((time) => time >= oneSecAgo);
  if (list.length >= maxPerSec) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  return true;
};
