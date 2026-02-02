/**
 * Debrid key management and verification
 */

import type { ModuleContext, StreamResult } from '../../types';
import { getFromCache, setCache, fetchWithRetry } from '../utils';
import { TORBOX_API_BASE, MUSIC_API_BASE, CONFIG } from './constants';
import type { DebridKey, VerifyResult } from './types';

export function getEffectiveDebridKey(context: ModuleContext): DebridKey | null {
  const setting = context?.settings?.torboxApiKey;
  const moduleKey = setting && typeof setting === 'object' ? setting.value : setting;

  if (moduleKey && typeof moduleKey === 'string' && moduleKey.trim()) {
    return { apiKey: moduleKey.trim(), provider: 'torbox', source: 'module' };
  }

  if (context?.debridApiKey) {
    return {
      apiKey: context.debridApiKey,
      provider: context.debridProvider || 'unknown',
      source: 'global',
    };
  }

  return null;
}

export async function verifyTorBoxKey(apiKey: string): Promise<VerifyResult> {
  try {
    const response = await fetch(TORBOX_API_BASE + '/user/me', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    });

    const data = (await response.json()) as {
      success?: boolean;
      detail?: string;
      data?: {
        email?: string;
        username?: string;
        plan?: number;
        premium_expires_at?: string;
      };
    };

    if (!response.ok || !data.success) {
      return { success: false, error: data.detail || 'Invalid API key' };
    }

    const userData = data.data || {};
    return {
      success: true,
      accountName: userData.email || userData.username || 'TorBox User',
      plan: userData.plan === 2 ? 'Pro' : userData.plan === 1 ? 'Standard' : 'Free',
      expiry: userData.premium_expires_at
        ? new Date(userData.premium_expires_at).toLocaleDateString()
        : 'Never',
    };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function resolveViaAPI(
  infoHash: string,
  service: string,
  apiKey: string,
  fileIndex: number = 0
): Promise<StreamResult> {
  const cacheKey = `stream:${infoHash}:${fileIndex}`;
  const cached = getFromCache<StreamResult>(cacheKey);

  if (cached) {
    console.log('[MusicTorrent] Using cached stream URL for', cacheKey);
    return cached;
  }

  const resp = await fetchWithRetry(
    `${MUSIC_API_BASE}/debrid`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: service,
        apiKey: apiKey,
        infoHash: infoHash,
        fileIndex: fileIndex,
      }),
    },
    {
      contextLabel: 'debrid resolution',
      maxRetries: CONFIG.RATE_LIMIT_MAX_RETRIES,
      baseDelay: CONFIG.RATE_LIMIT_BASE_DELAY,
      maxDelay: CONFIG.RATE_LIMIT_MAX_DELAY,
    }
  );

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error('Debrid resolution failed: ' + (errorText || 'HTTP ' + resp.status));
  }

  const data = (await resp.json()) as {
    success?: boolean;
    status?: string;
    error?: string;
    downloadUrl?: string;
  };

  if (!data.success) {
    if (data.status === 'downloading') {
      throw new Error('Torrent is downloading. Please try again in a few moments.');
    }
    throw new Error('Debrid resolution failed: ' + (data.error || 'Unknown error'));
  }

  const result: StreamResult = {
    streamUrl: data.downloadUrl!,
    track: {
      id: 'tor:' + infoHash,
      duration: 0,
    },
  };

  setCache(cacheKey, result);
  return result;
}
