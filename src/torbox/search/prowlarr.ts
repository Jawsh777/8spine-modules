/**
 * Prowlarr usenet search functionality
 */

import type { ModuleContext } from '../../../types';
import { parseTorrentName, formatBytes } from '../../utils';
import { CONFIG, AUDIO_EXTENSIONS } from '../constants';
import type { TorrentTrack, TorrentSearchResult, ProwlarrConfig } from '../types';
import { sanitizeQuery, wait } from '../utils';
import { checkUsenetCached } from '../cache';

export function getProwlarrConfig(context: ModuleContext): ProwlarrConfig | null {
  const urlSetting = context?.settings?.prowlarrUrl;
  const apiKeySetting = context?.settings?.prowlarrApiKey;

  const url = typeof urlSetting === 'string' ? urlSetting : urlSetting?.value;
  const apiKey = typeof apiKeySetting === 'string' ? apiKeySetting : apiKeySetting?.value;

  if (!url || !apiKey) {
    return null;
  }

  return {
    baseUrl: url.replace(/\/$/, ''),
    apiKey: apiKey.trim(),
  };
}

function extractFilenameFromSubject(subject: string): string | null {
  if (!subject) return null;

  let cleaned = subject.replace(/[\(\[]?\d+\/\d+[\)\]]?\s*$/i, '').trim();

  cleaned = cleaned
    .replace(/^(here'?s?|re:|fwd:)/i, '')
    .replace(/yEnc$/i, '')
    .trim();

  const audioMatch = cleaned.match(/([^\s"]+\.(mp3|flac|wav|aac|ogg|wma|opus|ape|alac))/i);
  if (audioMatch) {
    return audioMatch[1];
  }

  return cleaned;
}

async function parseNzbFile(
  nzbUrl: string,
  prowlarrConfig: ProwlarrConfig
): Promise<{ success: boolean; filenames: string[]; error?: string }> {
  try {
    const response = await fetch(nzbUrl, {
      method: 'GET',
      headers: {
        'X-Api-Key': prowlarrConfig.apiKey,
        Accept: 'application/x-nzb',
      },
    });

    if (!response.ok) {
      return { success: false, filenames: [], error: `HTTP ${response.status}` };
    }

    const xmlText = await response.text();

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      return { success: false, filenames: [], error: 'XML parse error' };
    }

    const fileElements = xmlDoc.querySelectorAll('file');
    const filenames: string[] = [];

    for (const fileElement of fileElements) {
      const subject = fileElement.getAttribute('subject');
      if (subject) {
        const filename = extractFilenameFromSubject(subject);
        if (filename && AUDIO_EXTENSIONS.test(filename)) {
          filenames.push(filename);
        }
      }
    }

    return { success: true, filenames: filenames.filter(Boolean) };
  } catch (e) {
    console.warn('[MusicTorrent] NZB parse error:', (e as Error).message);
    return { success: false, filenames: [], error: (e as Error).message };
  }
}

async function expandNzbIntoTracks(
  nzbRelease: TorrentTrack,
  prowlarrConfig: ProwlarrConfig
): Promise<TorrentTrack[]> {
  try {
    if (!nzbRelease.nzb) {
      return [{ ...nzbRelease, nzbParsed: false, nzbParseError: 'No NZB URL' }];
    }

    const nzbData = await parseNzbFile(nzbRelease.nzb, prowlarrConfig);

    if (nzbData.success && nzbData.filenames.length > 0) {
      const tracks: TorrentTrack[] = nzbData.filenames.map((filename, index) => {
        const parsed = parseTorrentName(filename);

        const trackNumMatch = filename.match(/(?:^|\D)(\d{1,3})(?:\s|-|_|\.)/);
        const trackNumber = trackNumMatch ? parseInt(trackNumMatch[1]) : index + 1;

        return {
          id: `${nzbRelease.id}-track-${index}`,
          title: parsed.album || filename.replace(/\.[^.]+$/, ''),
          artist: parsed.artist || nzbRelease.artist,
          album: parsed.album || nzbRelease.album,
          duration: 0,
          trackNumber: trackNumber,
          audioQuality: parsed.quality || nzbRelease.audioQuality,
          size: nzbRelease.size,
          sizeFormatted: nzbRelease.sizeFormatted,
          nzb: nzbRelease.nzb,
          hash: nzbRelease.hash,
          seeders: -1,
          leechers: -1,
          source: nzbRelease.source,
          cached: nzbRelease.cached,
          type: 'usenet',
          prowlarrGuid: nzbRelease.prowlarrGuid,
          publishDate: nzbRelease.publishDate,
          categories: nzbRelease.categories,
          nzbFilename: filename,
          nzbTotalTracks: nzbData.filenames.length,
          nzbParsed: true,
          index: index,
        };
      });

      return tracks;
    } else {
      console.warn('[MusicTorrent] NZB parse failed for:', nzbRelease.title, nzbData.error);
      return [
        {
          ...nzbRelease,
          nzbParsed: false,
          nzbParseError: nzbData.error,
        },
      ];
    }
  } catch (e) {
    console.warn('[MusicTorrent] NZB expansion failed for:', nzbRelease.title, (e as Error).message);
    return [
      {
        ...nzbRelease,
        nzbParsed: false,
        nzbParseError: (e as Error).message,
      },
    ];
  }
}

async function expandNzbsInBatches(
  nzbReleases: TorrentTrack[],
  prowlarrConfig: ProwlarrConfig,
  batchSize: number = 5
): Promise<TorrentTrack[]> {
  const allTracks: TorrentTrack[] = [];

  for (let i = 0; i < nzbReleases.length; i += batchSize) {
    const batch = nzbReleases.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map((release) => expandNzbIntoTracks(release, prowlarrConfig))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'fulfilled') {
        allTracks.push(...result.value);
      } else {
        console.warn('[MusicTorrent] Batch expansion failed:', result.reason);
        allTracks.push(batch[j]);
      }
    }

    if (i + batchSize < nzbReleases.length) {
      await wait(200);
    }
  }

  return allTracks;
}

export async function searchProwlarrUsenet(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  const sanitized = sanitizeQuery(query);
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  const prowlarr = getProwlarrConfig(context);
  if (!prowlarr) {
    throw new Error(
      'Prowlarr not configured. Please set Prowlarr URL and API key in module settings.'
    );
  }

  try {
    console.log('[MusicTorrent] Searching Prowlarr usenet:', sanitized);

    const params = new URLSearchParams({
      query: sanitized,
      type: 'search',
      limit: searchLimit.toString(),
    });

    const categories = [3000, 3010, 3040, 3050];
    categories.forEach((cat) => params.append('categories', cat.toString()));

    const url = `${prowlarr.baseUrl}/api/v1/search?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Api-Key': prowlarr.apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error('Prowlarr search failed: ' + (errorText || 'HTTP ' + response.status));
    }

    const results = (await response.json()) as Array<{
      releaseHash?: string;
      infoHash?: string;
      guid?: string;
      title?: string;
      size?: number;
      downloadUrl?: string;
      indexer?: string;
      publishDate?: string;
      categories?: number[];
    }>;

    if (!Array.isArray(results)) {
      throw new Error('Prowlarr returned invalid response format');
    }

    const usenetResults = results;

    const tracks: TorrentTrack[] = usenetResults.map((item, index) => {
      const hash = item.releaseHash || item.infoHash || item.guid || '';
      const uniqueId = hash
        ? 'prowlarr-nzb:' + hash
        : 'prowlarr-nzb:' +
          index +
          ':' +
          (item.title || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');

      const parsed = parseTorrentName(item.title || '');

      return {
        id: uniqueId,
        title: item.title || 'Unknown Title',
        artist: parsed.artist || 'Unknown Artist',
        album: parsed.album || 'Prowlarr Usenet',
        duration: 0,
        trackNumber: 1,
        audioQuality: parsed.quality || 'Unknown',
        size: item.size || 0,
        sizeFormatted: item.size ? formatBytes(item.size) : 'Unknown',
        nzb: item.downloadUrl,
        hash: hash,
        seeders: -1,
        leechers: -1,
        source: item.indexer || 'prowlarr',
        cached: false,
        type: 'usenet',
        prowlarrGuid: item.guid,
        publishDate: item.publishDate,
        categories: item.categories || [],
        index: 0,
      };
    });

    console.log('[MusicTorrent] Expanding', tracks.length, 'NZB releases into tracks...');
    let expandedTracks = tracks;
    let nzbParseStats = {
      nzbsProcessed: 0,
      nzbsParsed: 0,
      nzbsFailed: 0,
      tracksCreated: 0,
    };

    try {
      const nzbReleases = tracks;
      expandedTracks = await expandNzbsInBatches(nzbReleases, prowlarr, 5);

      const parsedNzbs = new Set(
        expandedTracks.filter((t) => t.nzbParsed === true).map((t) => t.nzb)
      );

      nzbParseStats = {
        nzbsProcessed: nzbReleases.length,
        nzbsParsed: parsedNzbs.size,
        nzbsFailed: nzbReleases.length - parsedNzbs.size,
        tracksCreated: expandedTracks.length,
      };

      console.log('[MusicTorrent] NZB expansion stats:', nzbParseStats);
      console.log(
        `[MusicTorrent] Expanded ${nzbReleases.length} NZBs into ${expandedTracks.length} tracks`
      );
    } catch (nzbErr) {
      console.warn('[MusicTorrent] NZB batch expansion failed:', nzbErr);
    }

    let cacheCheckFailed = false;
    try {
      const hashesToCheck = expandedTracks.filter((t) => t.hash).map((t) => t.hash!);

      if (hashesToCheck.length > 0) {
        const cacheStatus = await checkUsenetCached(hashesToCheck, context);

        for (const track of expandedTracks) {
          if (track.hash && cacheStatus[track.hash.toLowerCase()]) {
            track.cached = true;
          }
        }
      }
    } catch (cacheErr) {
      console.warn('[MusicTorrent] Auto-cache check failed for Prowlarr results:', cacheErr);
      cacheCheckFailed = true;
    }

    const result: TorrentSearchResult = {
      tracks: expandedTracks,
      total: expandedTracks.length,
      source: 'prowlarr-usenet',
      nzbParseStats: nzbParseStats,
    };

    if (cacheCheckFailed) {
      result.warning = 'Cache status unavailable - TorBox connection required';
    }

    return result;
  } catch (e) {
    console.error('[MusicTorrent] Prowlarr search failed:', e);
    throw e;
  }
}
