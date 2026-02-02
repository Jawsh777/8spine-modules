/**
 * Search functionality - main entry point
 */

import type { ModuleContext } from '../../../types';
import { CONFIG } from '../constants';
import type { TorrentTrack, TorrentSearchResult } from '../types';
import { sanitizeQuery } from '../utils';
import { searchTorrentTracks } from './torrent';
import { searchUsenetTracks } from './usenet';
import { searchProwlarrUsenet } from './prowlarr';

export { searchTorrentTracks } from './torrent';
export { searchUsenetTracks } from './usenet';
export { searchProwlarrUsenet, getProwlarrConfig } from './prowlarr';

export async function searchTracks(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  sanitizeQuery(query); // Validate query
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  const searchSourceSetting = context?.settings?.searchSource;
  const searchSource =
    typeof searchSourceSetting === 'string'
      ? searchSourceSetting
      : searchSourceSetting?.value || 'torrents';

  if (searchSource === 'torrents') {
    return await searchTorrentTracks(query, limit, context);
  }

  if (searchSource === 'usenet-torbox') {
    return await searchUsenetTracks(query, limit, context);
  }

  if (searchSource === 'usenet-prowlarr') {
    return await searchProwlarrUsenet(query, limit, context);
  }

  if (searchSource === 'usenet') {
    return await searchUsenetTracks(query, limit, context);
  }

  if (searchSource === 'both') {
    try {
      const searches = [
        searchTorrentTracks(query, Math.floor(searchLimit / 3), context),
        searchUsenetTracks(query, Math.floor(searchLimit / 3), context).catch(() => null),
        searchProwlarrUsenet(query, Math.floor(searchLimit / 3), context).catch(() => null),
      ];

      const results = await Promise.allSettled(searches);

      const tracks: TorrentTrack[] = [];
      let total = 0;

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          tracks.push(...result.value.tracks);
          total += result.value.total || 0;
        }
      }

      tracks.sort((a, b) => {
        if (a.cached && !b.cached) return -1;
        if (!a.cached && b.cached) return 1;
        return (b.seeders || 0) - (a.seeders || 0);
      });

      return {
        tracks: tracks.slice(0, searchLimit),
        total: total,
        source: 'all',
      };
    } catch (e) {
      console.warn('[MusicTorrent] Combined search failed, falling back to torrents:', e);
      return await searchTorrentTracks(query, limit, context);
    }
  }

  return await searchTorrentTracks(query, limit, context);
}
