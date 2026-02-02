/**
 * Usenet search functionality (TorBox Search API)
 */

import type { ModuleContext } from '../../../types';
import { parseTorrentName, formatBytes } from '../../utils';
import { TORBOX_SEARCH_API_BASE, CONFIG, ERRORS } from '../constants';
import type { TorrentTrack, TorrentSearchResult } from '../types';
import { sanitizeQuery } from '../utils';
import { getEffectiveDebridKey } from '../debrid';
import { checkUsenetCached } from '../cache';

export async function searchUsenetTracks(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  const sanitized = sanitizeQuery(query);
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  const debrid = getEffectiveDebridKey(context);
  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error(ERRORS.NO_TORBOX);
  }

  try {
    console.log('[MusicTorrent] Searching usenet:', sanitized);

    const url = `${TORBOX_SEARCH_API_BASE}/usenet/search/${encodeURIComponent(sanitized)}?check_cache=true&check_owned=true`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('Usenet search failed: ' + (errorText || 'HTTP ' + response.status));
    }

    const json = (await response.json()) as {
      success?: boolean;
      message?: string;
      data?: {
        nzbs?: Array<{
          hash?: string;
          title?: string;
          raw_title?: string;
          size?: number;
          nzb?: string;
          tracker?: string;
          cached?: boolean;
          owned?: boolean;
          categories?: number[];
          title_parsed_data?: { year?: number };
        }>;
        total_nzbs?: number;
      };
    };

    if (!json.success) {
      throw new Error('Usenet search failed: ' + (json.message || 'Unknown error'));
    }

    const nzbs = json.data?.nzbs || [];
    const limitedNzbs = nzbs.slice(0, searchLimit);

    const tracks: TorrentTrack[] = limitedNzbs.map((item, index) => {
      const hash = item.hash || '';
      const uniqueId = hash
        ? 'nzb:' + hash
        : 'nzb:' +
          index +
          ':' +
          (item.title || item.raw_title || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');

      const parsed = parseTorrentName(item.title || item.raw_title || '');

      return {
        id: uniqueId,
        title: item.title || item.raw_title || 'Unknown Title',
        artist: parsed.artist || 'Unknown Artist',
        album: parsed.album || 'Usenet',
        duration: 0,
        trackNumber: 1,
        audioQuality: parsed.quality || 'Unknown',
        year: item.title_parsed_data?.year || undefined,
        size: item.size || 0,
        sizeFormatted: item.size ? formatBytes(item.size) : 'Unknown',
        nzb: item.nzb,
        hash: hash,
        seeders: -1,
        leechers: -1,
        source: item.tracker || 'usenet',
        cached: item.cached || false,
        owned: item.owned || false,
        type: 'usenet',
        categories: item.categories || [],
      };
    });

    let cacheCheckFailed = false;
    try {
      const hashesToCheck = tracks.filter((t) => t.hash).map((t) => t.hash!);

      if (hashesToCheck.length > 0) {
        const cacheStatus = await checkUsenetCached(hashesToCheck, context);

        for (const track of tracks) {
          if (track.hash && cacheStatus[track.hash.toLowerCase()]) {
            track.cached = true;
          }
        }
      }
    } catch (cacheErr) {
      console.warn('[MusicTorrent] Auto-usenet cache check failed:', cacheErr);
      cacheCheckFailed = true;
    }

    const result: TorrentSearchResult = {
      tracks: tracks,
      total: json.data?.total_nzbs || nzbs.length,
      source: 'usenet',
    };

    if (cacheCheckFailed) {
      result.warning = 'Cache status unavailable - debrid connection required';
    }

    return result;
  } catch (e) {
    console.error('[MusicTorrent] Usenet search failed:', e);
    throw e;
  }
}
