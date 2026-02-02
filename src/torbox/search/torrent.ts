/**
 * Torrent search functionality
 */

import type { ModuleContext } from '../../../types';
import { validateHash, extractArtistFromTitle } from '../../utils';
import { MUSIC_API_BASE, CONFIG } from '../constants';
import type { TorrentTrack, TorrentSearchResult } from '../types';
import { sanitizeQuery } from '../utils';
import { checkCached } from '../cache';

export async function searchTorrentTracks(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  const sanitized = sanitizeQuery(query);
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  let url = `${MUSIC_API_BASE}/search?q=${encodeURIComponent(sanitized)}&limit=${searchLimit}`;

  const preferredFormatSetting = context?.settings?.preferredFormat;
  const preferredFormat =
    typeof preferredFormatSetting === 'string'
      ? preferredFormatSetting
      : preferredFormatSetting?.value;
  if (preferredFormat) {
    url += `&format=${encodeURIComponent(preferredFormat)}`;
  }

  try {
    console.log('[MusicTorrent] Searching:', url);
    const resp = await fetch(url);

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error('Search failed: ' + (errorText || 'HTTP ' + resp.status));
    }

    const json = (await resp.json()) as {
      results?: Array<{
        infoHash?: string;
        info_hash?: string;
        InfoHash?: string;
        magnetLink?: string;
        magnet_link?: string;
        magnet?: string;
        MagnetLink?: string;
        title?: string;
        artist?: string;
        album?: string;
        sizeFormatted?: string;
        format?: string;
        year?: number;
        size?: number;
        seeders?: number;
        leechers?: number;
        source?: string;
        description?: string;
      }>;
      count?: number;
    };
    const results = json.results || [];

    const tracks: TorrentTrack[] = results.map((item, index) => {
      const infoHash =
        item.infoHash ||
        item.info_hash ||
        item.InfoHash ||
        (item.magnetLink || item.magnet_link || item.magnet || '').match(
          /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i
        )?.[1];

      const magnet = item.magnetLink || item.magnet_link || item.magnet || item.MagnetLink;

      const uniqueId = infoHash
        ? 'tor:' + infoHash
        : 'idx:' + index + ':' + (item.title || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');

      return {
        id: uniqueId,
        title: item.title || 'Unknown Title',
        artist: item.artist || extractArtistFromTitle(item.title || '') || 'Unknown Artist',
        album: item.album || item.sizeFormatted || 'Torrent',
        duration: 0,
        trackNumber: 1,
        audioQuality: item.format || 'Unknown',
        year: item.year,
        size: item.size,
        sizeFormatted: item.sizeFormatted,
        magnet: magnet,
        infoHash: infoHash,
        hash: infoHash?.toLowerCase(),
        seeders: item.seeders || 0,
        leechers: item.leechers || 0,
        source: item.source || 'jackett',
      };
    });

    let cacheCheckFailed = false;
    try {
      const hashesToCheck = tracks.filter((t) => t.hash && validateHash(t.hash)).map((t) => t.hash!);

      if (hashesToCheck.length > 0) {
        const cacheStatus = await checkCached(hashesToCheck, context);

        for (const track of tracks) {
          if (track.hash && cacheStatus[track.hash.toLowerCase()]) {
            track.cached = true;
          }
        }
      }
    } catch (cacheErr) {
      console.warn('[MusicTorrent] Auto-cache check failed:', cacheErr);
      cacheCheckFailed = true;
    }

    const result: TorrentSearchResult = {
      tracks: tracks,
      total: json.count || results.length,
      source: 'torrents',
    };

    if (cacheCheckFailed) {
      result.warning = 'Cache status unavailable - debrid connection required';
    }

    return result;
  } catch (e) {
    console.error('[MusicTorrent] Search failed:', e);
    throw e;
  }
}
