/**
 * Simple in-memory cache with TTL
 */

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const CACHE: Record<string, CacheEntry<unknown>> = {};

const DEFAULT_TTL = 3600 * 1000; // 1 hour

export function getFromCache<T>(key: string): T | null {
  const entry = CACHE[key] as CacheEntry<T> | undefined;
  if (entry && entry.expires > Date.now()) {
    return entry.data;
  }
  return null;
}

export function setCache<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL): void {
  CACHE[key] = {
    data,
    expires: Date.now() + ttlMs,
  };
}

export function cleanCache(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const key in CACHE) {
    if (CACHE[key].expires < now) {
      delete CACHE[key];
      cleaned++;
    }
  }

  return cleaned;
}

export function clearCache(): void {
  for (const key in CACHE) {
    delete CACHE[key];
  }
}
