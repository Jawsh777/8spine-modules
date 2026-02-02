/**
 * Cache checking functionality for TorBox
 */

import type { ModuleContext } from '../../types';
import { validateHash } from '../utils';
import { TORBOX_API_BASE } from './constants';
import { getEffectiveDebridKey } from './debrid';

export async function checkCached(
  hashes: string[],
  context: ModuleContext
): Promise<Record<string, boolean>> {
  const debrid = getEffectiveDebridKey(context);

  console.log('[MusicTorrent] checkCached called with context:', !!context);
  console.log(
    '[MusicTorrent] Effective debrid:',
    debrid
      ? {
          provider: debrid.provider,
          source: debrid.source,
          hasKey: !!debrid.apiKey,
        }
      : null
  );

  if (!debrid) {
    console.log('[MusicTorrent] No debrid key available for cache check');
    return {};
  }

  if (debrid.provider !== 'torbox') {
    console.log('[MusicTorrent] Provider is not TorBox, skipping cache check');
    return {};
  }

  if (!hashes || hashes.length === 0) {
    return {};
  }

  const validHashes = hashes.filter((h) => h && typeof h === 'string' && validateHash(h));
  if (validHashes.length === 0) {
    console.warn('[MusicTorrent] No valid hashes to check');
    return {};
  }

  try {
    console.log('[MusicTorrent] Checking TorBox cache for', validHashes.length, 'hashes');

    const url =
      TORBOX_API_BASE + '/torrents/checkcached?hash=' + validHashes.join(',') + '&format=object';

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      console.warn('[MusicTorrent] Cache check failed:', response.status);
      return {};
    }

    const data = (await response.json()) as {
      success?: boolean;
      detail?: string;
      data?: Record<string, unknown>;
    };

    if (!data.success) {
      console.warn('[MusicTorrent] Cache check unsuccessful:', data.detail);
      return {};
    }

    const cacheStatus: Record<string, boolean> = {};
    const cachedData = data.data || {};

    const normalizedCacheData: Record<string, unknown> = {};
    for (const key in cachedData) {
      normalizedCacheData[key.toLowerCase()] = cachedData[key];
    }

    for (const hash of validHashes) {
      const hashLower = hash.toLowerCase();
      const cacheEntry = normalizedCacheData[hashLower];
      cacheStatus[hashLower] = !!cacheEntry;
    }

    const cachedCount = Object.values(cacheStatus).filter(Boolean).length;
    console.log(
      '[MusicTorrent] Cache check result:',
      cachedCount,
      'of',
      validHashes.length,
      'cached'
    );

    return cacheStatus;
  } catch (e) {
    console.error('[MusicTorrent] Cache check error:', e);
    return {};
  }
}

export async function checkUsenetCached(
  hashes: string[],
  context: ModuleContext
): Promise<Record<string, boolean>> {
  const debrid = getEffectiveDebridKey(context);

  console.log('[MusicTorrent] checkUsenetCached called with context:', !!context);
  console.log(
    '[MusicTorrent] Effective debrid:',
    debrid
      ? {
          provider: debrid.provider,
          source: debrid.source,
          hasKey: !!debrid.apiKey,
        }
      : null
  );

  if (!debrid) {
    console.log('[MusicTorrent] No debrid key available for usenet cache check');
    return {};
  }

  if (debrid.provider !== 'torbox') {
    console.log('[MusicTorrent] Provider is not TorBox, skipping usenet cache check');
    return {};
  }

  if (!hashes || hashes.length === 0) {
    return {};
  }

  const validHashes = hashes.filter((h) => h && typeof h === 'string');
  if (validHashes.length === 0) {
    console.warn('[MusicTorrent] No valid hashes to check for usenet');
    return {};
  }

  try {
    console.log('[MusicTorrent] Checking TorBox usenet cache for', validHashes.length, 'hashes');

    const url =
      TORBOX_API_BASE + '/usenet/checkcached?hash=' + validHashes.join(',') + '&format=object';

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      console.warn('[MusicTorrent] Usenet cache check failed:', response.status);
      return {};
    }

    const data = (await response.json()) as {
      success?: boolean;
      detail?: string;
      data?: Record<string, unknown>;
    };

    if (!data.success) {
      console.warn('[MusicTorrent] Usenet cache check unsuccessful:', data.detail);
      return {};
    }

    const cacheStatus: Record<string, boolean> = {};
    const cachedData = data.data || {};

    const normalizedCacheData: Record<string, unknown> = {};
    for (const key in cachedData) {
      normalizedCacheData[key.toLowerCase()] = cachedData[key];
    }

    for (const hash of validHashes) {
      const hashLower = hash.toLowerCase();
      const cacheEntry = normalizedCacheData[hashLower];
      cacheStatus[hashLower] = !!cacheEntry;
    }

    const cachedCount = Object.values(cacheStatus).filter(Boolean).length;
    console.log(
      '[MusicTorrent] Usenet cache check result:',
      cachedCount,
      'of',
      validHashes.length,
      'cached'
    );

    return cacheStatus;
  } catch (e) {
    console.error('[MusicTorrent] Usenet cache check error:', e);
    return {};
  }
}
