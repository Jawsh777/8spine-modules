/**
 * Utility functions for the TorBox module
 */

import { cleanCache } from '../utils';
import { CONFIG, TRACKERS, MUSIC_API_BASE } from './constants';

let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function initCacheCleanup(): void {
  if (!cacheCleanupTimer) {
    cacheCleanupTimer = setInterval(() => {
      const cleaned = cleanCache();
      if (cleaned > 0) {
        console.log(`[MusicTorrent] Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, CONFIG.CACHE_CLEANUP_INTERVAL);
  }
}

export function stopCacheCleanup(): void {
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
}

export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function sanitizeQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    throw new Error('Invalid search query');
  }

  const trimmed = query.trim();

  if (trimmed.length === 0) {
    throw new Error('Please enter a search query');
  }

  if (trimmed.length > CONFIG.MAX_QUERY_LENGTH) {
    throw new Error(`Search query too long (max ${CONFIG.MAX_QUERY_LENGTH} characters)`);
  }

  return trimmed.replace(/[<>]/g, '');
}

export function mapProviderName(provider: string): string {
  const mapping: Record<string, string> = {
    realdebrid: 'realdebrid',
    torbox: 'torbox',
    premiumize: 'premiumize',
    alldebrid: 'alldebrid',
    debridlink: 'debridlink',
    offcloud: 'offcloud',
    putio: 'putio',
  };
  return mapping[provider] || provider;
}

export function normalizeMagnetPrefix(magnetLink: string): string {
  if (!magnetLink) return magnetLink;

  if (magnetLink.startsWith('magnet:magnet:')) {
    return magnetLink.substring(7);
  }

  return magnetLink;
}

export async function getMagnetLink(infoHash: string, existingMagnet?: string): Promise<string> {
  if (existingMagnet) return existingMagnet;

  if (!infoHash) {
    throw new Error('No info hash available to generate magnet link');
  }

  try {
    const resp = await fetch(`${MUSIC_API_BASE}/magnet/${infoHash}`);
    if (resp.ok) {
      const data = (await resp.json()) as { magnetLink?: string };
      if (data.magnetLink) {
        return data.magnetLink;
      }
    }
  } catch (e) {
    console.warn('[MusicTorrent] Failed to fetch magnet from API, using fallback');
  }

  return `magnet:?xt=urn:btih:${infoHash}&tr=` + TRACKERS.map(encodeURIComponent).join('&tr=');
}
