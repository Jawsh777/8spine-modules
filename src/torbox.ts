// @8spine-export GLOBAL_SEARCH_MODULE_CODE
/* @8spine-meta
 * type: MODULE
 * category: debrid_modules
 * featured: false
 * trusted: true
 * nsfw: false
 */
/**
 * Music Torrent + Usenet Search Module
 * Searches music from torrents (Torrentio API) and usenet (TorBox Search API)
 * Integrates with TorBox for instant streaming/downloading from both sources.
 * Supports cache checking, cloud management, and unified search interface.
 * API Documentation: https://search-api.torbox.app
 */

import type {
  Module8Spine,
  Track,
  SearchResult,
  StreamResult,
  AlbumDetails,
  ModuleContext,
  QualityPreference,
} from '../types';
import {
  getFromCache,
  setCache,
  cleanCache,
  validateHash,
  extractHash,
  parseTorrentName,
  formatBytes,
  extractArtistFromTitle,
  fetchWithRetry,
  type ParsedTorrentName,
} from './utils';

// ============================================================================
// CONSTANTS
// ============================================================================

const MUSIC_API_BASE = 'https://torrentio-addon-626866336386.europe-west4.run.app/music';
const TORBOX_API_BASE = 'https://api.torbox.app/v1/api';
const TORBOX_SEARCH_API_BASE = 'https://search-api.torbox.app';
const REALDEBRID_API_BASE = 'https://api.real-debrid.com/rest/1.0';

const CONFIG = {
  MAX_SEARCH_LIMIT: 50,
  TORRENT_POLL_ATTEMPTS: 20,
  REALDEBRID_POLL_ATTEMPTS: 30,
  POLL_INTERVAL: 2000,
  MAX_QUERY_LENGTH: 500,
  RATE_LIMIT_MAX_RETRIES: 5,
  RATE_LIMIT_BASE_DELAY: 1000,
  RATE_LIMIT_MAX_DELAY: 30000,
  CACHE_TTL: 3600 * 1000,
  CACHE_CLEANUP_INTERVAL: 600 * 1000,
  HASH_LENGTH_V1: 40,
  HASH_LENGTH_V2: 32,
};

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://zer0day.ch:1337/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://p4p.arenabg.com:1337/announce',
];

const TORBOX_LOGO = 'https://avatars.githubusercontent.com/u/144096078?s=280&v=4';

const ERRORS = {
  NO_DEBRID: 'Debrid connection required. Configure TorBox API key in module settings.',
  NO_TORBOX: 'TorBox connection required for this feature. Configure API key in module settings.',
  UNSUPPORTED_PROVIDER: (provider: string) =>
    `Provider "${provider}" not supported for this feature. TorBox required.`,
};

const AUDIO_EXTENSIONS = /\.(mp3|flac|wav|aac|ogg|wma|opus|ape|alac)$/i;
const VIDEO_PATTERNS = [
  /\b(1080p|720p|2160p|480p|4k|uhd|bluray|bdrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|x264|x265|hevc|h\.?264|h\.?265)\b/i,
  /\b(s\d{1,2}e\d{1,2}|season\s*\d+|episode\s*\d+|S\d{2})\b/i,
  /\b(movie|film|cinema|theatrical|directors\.cut|extended\.cut)\b/i,
  /\.(mkv|mp4|avi|mov|wmv|m4v)$/i,
];

// ============================================================================
// TYPES
// ============================================================================

interface DebridKey {
  apiKey: string;
  provider: string;
  source: string;
}

interface ProwlarrConfig {
  baseUrl: string;
  apiKey: string;
}

interface TorrentTrack extends Track {
  magnet?: string;
  infoHash?: string;
  hash?: string;
  seeders?: number;
  leechers?: number;
  source?: string;
  size?: number;
  sizeFormatted?: string;
  year?: number;
  cached?: boolean;
  owned?: boolean;
  type?: string;
  nzb?: string;
  categories?: number[];
  prowlarrGuid?: string;
  publishDate?: string;
  nzbFilename?: string;
  nzbTotalTracks?: number;
  nzbParsed?: boolean;
  nzbParseError?: string;
  index?: number;
}

interface TorrentSearchResult extends SearchResult {
  tracks: TorrentTrack[];
  source?: string;
  warning?: string;
  nzbParseStats?: {
    nzbsProcessed: number;
    nzbsParsed: number;
    nzbsFailed: number;
    tracksCreated: number;
  };
}

interface CloudAlbum {
  id: string;
  hash?: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  parsed: ParsedTorrentName;
  provider: string;
  source: string;
  type: string;
}

interface TorBoxFile {
  id: number;
  name: string;
  short_name?: string;
  size: number;
}

interface TorBoxTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  download_finished?: boolean;
  files?: TorBoxFile[];
}

interface TorBoxUsenet {
  id: number;
  hash: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  download_finished?: boolean;
  files?: TorBoxFile[];
}

interface VerifyResult {
  success: boolean;
  error?: string;
  accountName?: string;
  plan?: string;
  expiry?: string;
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

let cacheCleanupTimer: ReturnType<typeof setInterval> | null = null;

function initCacheCleanup(): void {
  if (!cacheCleanupTimer) {
    cacheCleanupTimer = setInterval(() => {
      const cleaned = cleanCache();
      if (cleaned > 0) {
        console.log(`[MusicTorrent] Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, CONFIG.CACHE_CLEANUP_INTERVAL);
  }
}

function stopCacheCleanup(): void {
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
}

initCacheCleanup();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeQuery(query: string): string {
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

function mapProviderName(provider: string): string {
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

function normalizeMagnetPrefix(magnetLink: string): string {
  if (!magnetLink) return magnetLink;

  if (magnetLink.startsWith('magnet:magnet:')) {
    return magnetLink.substring(7);
  }

  return magnetLink;
}

// ============================================================================
// DEBRID KEY MANAGEMENT
// ============================================================================

function getEffectiveDebridKey(context: ModuleContext): DebridKey | null {
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

async function verifyTorBoxKey(apiKey: string): Promise<VerifyResult> {
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

// ============================================================================
// MAGNET LINK HELPERS
// ============================================================================

async function getMagnetLink(infoHash: string, existingMagnet?: string): Promise<string> {
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

// ============================================================================
// CACHE CHECKING
// ============================================================================

async function checkCached(
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

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: Record<string, unknown> };

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

async function checkUsenetCached(
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

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: Record<string, unknown> };

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

// ============================================================================
// SEARCH FUNCTIONALITY
// ============================================================================

async function searchTracks(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  const sanitized = sanitizeQuery(query);
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  const searchSourceSetting = context?.settings?.searchSource;
  const searchSource = typeof searchSourceSetting === 'string' ? searchSourceSetting : searchSourceSetting?.value || 'torrents';

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

async function searchTorrentTracks(
  query: string,
  limit: number,
  context: ModuleContext
): Promise<TorrentSearchResult> {
  const sanitized = sanitizeQuery(query);
  const searchLimit = Math.min(limit || CONFIG.MAX_SEARCH_LIMIT, CONFIG.MAX_SEARCH_LIMIT);

  let url = `${MUSIC_API_BASE}/search?q=${encodeURIComponent(sanitized)}&limit=${searchLimit}`;

  const preferredFormatSetting = context?.settings?.preferredFormat;
  const preferredFormat = typeof preferredFormatSetting === 'string' ? preferredFormatSetting : preferredFormatSetting?.value;
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

    const json = (await resp.json()) as { results?: Array<{
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
    }>; count?: number };
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

// ============================================================================
// USENET SEARCH FUNCTIONALITY
// ============================================================================

async function searchUsenetTracks(
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

// ============================================================================
// PROWLARR SEARCH FUNCTIONALITY
// ============================================================================

function getProwlarrConfig(context: ModuleContext): ProwlarrConfig | null {
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

async function searchProwlarrUsenet(
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

// ============================================================================
// DEBRID RESOLUTION
// ============================================================================

async function resolveViaAPI(
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

// ============================================================================
// TORBOX PROCESSING
// ============================================================================

async function processTorBox(
  magnet: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding magnet to TorBox');

  const formData = new FormData();
  formData.append('magnet', magnet);
  formData.append('seed', '1');
  formData.append('allow_zip', 'false');

  const addReq = await fetch(TORBOX_API_BASE + '/torrents/createtorrent', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
    },
    body: formData,
  });

  const addRespText = await addReq.text();
  let addResp: { success?: boolean; detail?: string; data?: { torrent_id: number } };

  try {
    addResp = JSON.parse(addRespText);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + addRespText.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      console.log('[MusicTorrent] Torrent exists, finding ID...');

      const hash = extractHash(magnet);
      if (!hash) {
        throw new Error('Torrent exists but could not extract hash to locate it');
      }

      const listResp = (await fetch(TORBOX_API_BASE + '/torrents/mylist?bypass_cache=true', {
        headers: { Authorization: 'Bearer ' + context.debridApiKey },
      }).then((r) => r.json())) as { success?: boolean; data?: TorBoxTorrent[] };

      if (!listResp.success) {
        throw new Error('Failed to retrieve torrent list');
      }

      const list = Array.isArray(listResp.data) ? listResp.data : [];
      const existing = list.find((t) => t.hash && t.hash.toLowerCase() === hash.toLowerCase());

      if (existing) {
        return await processTorBoxTorrent(existing.id, context, trackId);
      } else {
        throw new Error('Torrent reported as existing but not found in your library');
      }
    }

    throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add torrent'));
  }

  return await processTorBoxTorrent(addResp.data!.torrent_id, context, trackId);
}

async function processTorBoxTorrent(
  torrentId: number,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  let fileId: number | null = null;
  let attempts = 0;

  while (attempts < CONFIG.TORRENT_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const info = (await fetch(TORBOX_API_BASE + '/torrents/mylist?id=' + torrentId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    }).then((r) => r.json())) as { success?: boolean; data?: TorBoxTorrent | TorBoxTorrent[] };

    if (info.success && info.data) {
      const dataArray = Array.isArray(info.data) ? info.data : [info.data];
      const data = dataArray[0];

      if (data) {
        const isReady =
          data.download_state === 'cached' ||
          data.download_state === 'completed' ||
          data.download_finished;

        if (isReady && data.files && data.files.length > 0) {
          const media = data.files.filter((f) => f.name && AUDIO_EXTENSIONS.test(f.name));

          if (media.length > 0) {
            media.sort((a, b) => (b.size || 0) - (a.size || 0));
            fileId = media[0].id;
            break;
          }
        }
      }
    }

    attempts++;
  }

  if (!fileId) {
    throw new Error(
      'Torrent processing timed out or no audio files found. ' + 'Check your TorBox dashboard.'
    );
  }

  const url = `${TORBOX_API_BASE}/torrents/requestdl`;
  const params = new URLSearchParams({
    torrent_id: torrentId.toString(),
    file_id: fileId.toString(),
    zip_link: 'false',
  });

  const linkResp = (await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; detail?: string; data?: string };

  if (!linkResp.success) {
    throw new Error(linkResp.detail || 'Failed to get download link');
  }

  return {
    streamUrl: linkResp.data!,
    track: {
      id: trackId,
      duration: 0,
    },
  };
}

// ============================================================================
// USENET PROCESSING
// ============================================================================

async function processUsenetDownload(
  nzbUrl: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding NZB to TorBox usenet');

  const formData = new FormData();
  formData.append('link', nzbUrl);
  formData.append('seed', '1');
  formData.append('post_processing', '-1');

  const addReq = await fetch(TORBOX_API_BASE + '/usenet/createusenetdownload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
    },
    body: formData,
  });

  const addRespText = await addReq.text();
  let addResp: { success?: boolean; detail?: string; data?: { usenet_id: number } };

  try {
    addResp = JSON.parse(addRespText);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + addRespText.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      console.log('[MusicTorrent] Usenet download exists, finding ID...');

      const listResp = (await fetch(TORBOX_API_BASE + '/usenet/mylist?bypass_cache=true', {
        headers: { Authorization: 'Bearer ' + context.debridApiKey },
      }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet[] };

      if (!listResp.success) {
        throw new Error('Failed to retrieve usenet list');
      }

      const list = Array.isArray(listResp.data) ? listResp.data : [];

      const hash = trackId.startsWith('nzb:') ? trackId.substring(4).split(':')[0] : trackId;

      const existing = list.find(
        (u) =>
          (u.hash && u.hash.toLowerCase() === hash.toLowerCase()) ||
          (u.name && u.name === nzbUrl.split('/').pop())
      );

      if (existing) {
        return await processUsenetItem(existing.id, context, trackId);
      } else {
        throw new Error('Usenet download reported as existing but not found in your library');
      }
    }

    throw new Error('TorBox usenet error: ' + (addResp.detail || 'Failed to add NZB'));
  }

  return await processUsenetItem(addResp.data!.usenet_id, context, trackId);
}

async function processUsenetItem(
  usenetId: number,
  context: ModuleContext,
  trackId: string,
  trackIndex: number = 0
): Promise<StreamResult> {
  let fileId: number | null = null;
  let attempts = 0;

  while (attempts < CONFIG.TORRENT_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const info = (await fetch(TORBOX_API_BASE + '/usenet/mylist?id=' + usenetId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet | TorBoxUsenet[] };

    if (info.success && info.data) {
      const dataArray = Array.isArray(info.data) ? info.data : [info.data];
      const data = dataArray[0];

      if (data) {
        const isReady =
          data.download_state === 'cached' ||
          data.download_state === 'completed' ||
          data.download_finished;

        if (isReady && data.files && data.files.length > 0) {
          const media = data.files.filter((f) => f.name && AUDIO_EXTENSIONS.test(f.name));

          if (media.length > 0) {
            media.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (trackIndex < media.length) {
              fileId = media[trackIndex].id;
            } else {
              fileId = media[0].id;
            }
            break;
          }
        }
      }
    }

    attempts++;
  }

  if (!fileId) {
    throw new Error(
      'Usenet processing timed out or no audio files found. ' + 'Check your TorBox dashboard.'
    );
  }

  const url = `${TORBOX_API_BASE}/usenet/requestdl`;
  const params = new URLSearchParams({
    usenet_id: usenetId.toString(),
    file_id: fileId.toString(),
    zip_link: 'false',
  });

  const linkResp = (await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; detail?: string; data?: string };

  if (!linkResp.success) {
    throw new Error(linkResp.detail || 'Failed to get usenet download link');
  }

  return {
    streamUrl: linkResp.data!,
    track: {
      id: trackId,
      duration: 0,
    },
  };
}

// ============================================================================
// REAL-DEBRID PROCESSING
// ============================================================================

async function processRealDebrid(
  magnet: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding magnet to Real-Debrid');

  const addResp = await fetch(REALDEBRID_API_BASE + '/torrents/addMagnet', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'magnet=' + encodeURIComponent(magnet),
  });

  if (!addResp.ok) {
    const errorData = (await addResp.json().catch(() => ({}))) as { error?: string };
    throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to add magnet'));
  }

  const addData = (await addResp.json()) as { id: string };
  const torrentId = addData.id;
  console.log('[MusicTorrent] Real-Debrid torrent ID:', torrentId);

  const selectResp = await fetch(REALDEBRID_API_BASE + '/torrents/selectFiles/' + torrentId, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'files=all',
  });

  if (!selectResp.ok) {
    const errorData = (await selectResp.json().catch(() => ({}))) as { error?: string };
    throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to select files'));
  }

  let attempts = 0;

  while (attempts < CONFIG.REALDEBRID_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const infoResp = await fetch(REALDEBRID_API_BASE + '/torrents/info/' + torrentId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    });

    if (!infoResp.ok) {
      attempts++;
      continue;
    }

    const infoData = (await infoResp.json()) as { status: string; links?: string[] };
    console.log('[MusicTorrent] Real-Debrid status:', infoData.status);

    if (infoData.status === 'downloaded' && infoData.links?.length && infoData.links.length > 0) {
      const link = infoData.links[0];

      const unrestrictResp = await fetch(REALDEBRID_API_BASE + '/unrestrict/link', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + context.debridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'link=' + encodeURIComponent(link),
      });

      if (!unrestrictResp.ok) {
        throw new Error('Real-Debrid: Failed to unrestrict download link');
      }

      const unrestrictData = (await unrestrictResp.json()) as { download: string };
      return {
        streamUrl: unrestrictData.download,
        track: {
          id: trackId,
          duration: 0,
        },
      };
    }

    attempts++;
  }

  throw new Error('Torrent processing timed out. Check your Real-Debrid dashboard for status.');
}

// ============================================================================
// STREAM URL RETRIEVAL
// ============================================================================

async function getUsenetStreamUrl(
  trackId: string,
  quality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  const validPrefixes = ['nzb:', 'prowlarr-nzb:'];
  const hasValidPrefix = validPrefixes.some((prefix) => trackId.startsWith(prefix));

  if (!hasValidPrefix) {
    throw new Error('Invalid usenet track ID format - expected "nzb:" or "prowlarr-nzb:" prefix');
  }

  if (!context.debridApiKey) {
    throw new Error(ERRORS.NO_DEBRID);
  }

  if (context.debridProvider !== 'torbox') {
    throw new Error(ERRORS.UNSUPPORTED_PROVIDER(context.debridProvider || 'unknown'));
  }

  let hash: string;
  let trackIndex = 0;

  if (trackId.startsWith('prowlarr-nzb:')) {
    const afterPrefix = trackId.substring(13);
    const trackSuffixMatch = afterPrefix.match(/^(.+)-track-(\d+)$/);
    if (trackSuffixMatch) {
      hash = trackSuffixMatch[1];
      trackIndex = parseInt(trackSuffixMatch[2]);
    } else {
      hash = afterPrefix;
    }
  } else {
    hash = trackId.substring(4);
  }

  const listResp = (await fetch(TORBOX_API_BASE + '/usenet/mylist', {
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet[] };

  if (!listResp.success) {
    throw new Error('Failed to get usenet download list');
  }

  const downloads = listResp.data || [];
  const usenetDownload = downloads.find(
    (d) =>
      (d.hash && d.hash.toLowerCase() === hash.toLowerCase()) ||
      (d.id && d.id.toString() === hash) ||
      (d.name && hash.length > 5 && d.name.toLowerCase().includes(hash.toLowerCase()))
  );

  if (!usenetDownload) {
    throw new Error('Usenet download not found in your library. Please add it to cloud first.');
  }

  return await processUsenetItem(usenetDownload.id, context, trackId, trackIndex);
}

async function getTrackStreamUrl(
  trackId: string,
  quality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  if (trackId.startsWith('nzb:') || trackId.startsWith('prowlarr-nzb:')) {
    return await getUsenetStreamUrl(trackId, quality, context);
  }

  let infoHash: string | null = null;
  let magnet: string | undefined = undefined;

  if (trackId.startsWith('tor:')) {
    infoHash = trackId.substring(4);
  } else if (trackId.startsWith('magnet:')) {
    magnet = normalizeMagnetPrefix(trackId);
    infoHash = extractHash(magnet);
  } else {
    infoHash = trackId;
  }

  if (!infoHash) {
    throw new Error('Could not extract info hash from track ID');
  }

  if (!context.debridApiKey) {
    throw new Error(ERRORS.NO_DEBRID);
  }

  const provider = mapProviderName(context.debridProvider || 'unknown');

  try {
    console.log('[MusicTorrent] Resolving via API debrid endpoint...');
    const resolveResult = await resolveViaAPI(infoHash, provider, context.debridApiKey);
    if (resolveResult) {
      return resolveResult;
    }
  } catch (e) {
    console.warn('[MusicTorrent] API resolve failed, using fallback:', (e as Error).message);
  }

  magnet = await getMagnetLink(infoHash, magnet);

  if (context.debridProvider === 'realdebrid') {
    return await processRealDebrid(magnet, context, trackId);
  } else if (context.debridProvider === 'torbox') {
    return await processTorBox(magnet, context, trackId);
  } else {
    throw new Error(
      `Direct processing not implemented for ${context.debridProvider}. ` + 'API resolution failed.'
    );
  }
}

// ============================================================================
// ADD TO CLOUD
// ============================================================================

async function addToCloud(
  track: TorrentTrack,
  context: ModuleContext
): Promise<{ success: boolean; message: string }> {
  if (
    track.id.startsWith('nzb:') ||
    track.id.startsWith('prowlarr-nzb:') ||
    track.type === 'usenet'
  ) {
    return await addUsenetToCloud(track, context);
  }

  let infoHash: string | null = null;
  let magnet: string | undefined = undefined;

  if (track.infoHash) {
    infoHash = track.infoHash;
  } else if (track.id.startsWith('tor:')) {
    infoHash = track.id.substring(4);
  } else if (track.id.startsWith('magnet:')) {
    magnet = normalizeMagnetPrefix(track.id);
    infoHash = extractHash(magnet);
  }

  if (track.magnet && !magnet) {
    magnet = track.magnet;
  }

  if (!magnet) {
    magnet = await getMagnetLink(infoHash || '', magnet);
  }

  if (!magnet) {
    throw new Error('Could not determine magnet link for torrent');
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid) {
    throw new Error(ERRORS.NO_TORBOX);
  }

  const { apiKey, provider, source } = debrid;
  console.log('[MusicTorrent] Using debrid from:', source, '- Provider:', provider);

  if (provider === 'torbox') {
    console.log('[MusicTorrent] Adding magnet to TorBox');

    const formData = new FormData();
    formData.append('magnet', magnet);
    formData.append('seed', '1');
    formData.append('allow_zip', 'false');

    const addReq = await fetch(TORBOX_API_BASE + '/torrents/createtorrent', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
      },
      body: formData,
    });

    const text = await addReq.text();
    let addResp: { success?: boolean; detail?: string };

    try {
      addResp = JSON.parse(text);
    } catch (e) {
      throw new Error('TorBox returned invalid JSON: ' + text.substring(0, 100));
    }

    if (!addResp || !addResp.success) {
      if (addResp?.detail?.includes('already exists')) {
        return { success: true, message: 'Torrent already exists in TorBox' };
      }
      throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add torrent'));
    }

    return { success: true, message: 'Torrent added to TorBox successfully' };
  } else if (provider === 'realdebrid') {
    console.log('[MusicTorrent] Adding magnet to Real-Debrid');

    const addResp = await fetch(REALDEBRID_API_BASE + '/torrents/addMagnet', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'magnet=' + encodeURIComponent(magnet),
    });

    if (!addResp.ok) {
      const errorData = (await addResp.json().catch(() => ({}))) as { error?: string };
      throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to add magnet'));
    }

    const addData = (await addResp.json()) as { id: string };

    const selectResp = await fetch(REALDEBRID_API_BASE + '/torrents/selectFiles/' + addData.id, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'files=all',
    });

    if (!selectResp.ok) {
      const errorData = (await selectResp.json().catch(() => ({}))) as { error?: string };
      throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to select files'));
    }

    return { success: true, message: 'Torrent added to Real-Debrid successfully' };
  } else {
    throw new Error('Unsupported debrid provider: ' + provider);
  }
}

async function addUsenetToCloud(
  track: TorrentTrack,
  context: ModuleContext
): Promise<{ success: boolean; message: string }> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid) {
    throw new Error(ERRORS.NO_TORBOX);
  }

  if (debrid.provider !== 'torbox') {
    throw new Error(ERRORS.UNSUPPORTED_PROVIDER(debrid.provider));
  }

  const { apiKey, provider, source } = debrid;
  console.log('[MusicTorrent] Using debrid from:', source, '- Provider:', provider);

  if (!track.nzb) {
    throw new Error('No NZB URL available for this track');
  }

  console.log('[MusicTorrent] Adding NZB to TorBox');

  const formData = new FormData();
  formData.append('link', track.nzb);
  formData.append('seed', '1');
  formData.append('post_processing', '-1');

  const addReq = await fetch(TORBOX_API_BASE + '/usenet/createusenetdownload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
    },
    body: formData,
  });

  const text = await addReq.text();
  let addResp: { success?: boolean; detail?: string };

  try {
    addResp = JSON.parse(text);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + text.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      return { success: true, message: 'Usenet download already exists in TorBox' };
    }
    throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add NZB'));
  }

  return { success: true, message: 'Usenet download added to TorBox successfully' };
}

// ============================================================================
// CLOUD ALBUMS MANAGEMENT
// ============================================================================

async function getCloudAlbums(
  context: ModuleContext
): Promise<{ albums: CloudAlbum[]; provider: string | null }> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    console.log('[MusicTorrent] No TorBox key available for cloud albums');
    return { albums: [], provider: null };
  }

  try {
    console.log('[MusicTorrent] Fetching TorBox cloud albums...');

    const [torrentResponse, usenetResponse] = await Promise.allSettled([
      fetch(TORBOX_API_BASE + '/torrents/mylist', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + debrid.apiKey },
      }),
      fetch(TORBOX_API_BASE + '/usenet/mylist', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + debrid.apiKey },
      }),
    ]);

    const albums: CloudAlbum[] = [];

    if (torrentResponse.status === 'fulfilled' && torrentResponse.value.ok) {
      const torrentData = (await torrentResponse.value.json()) as {
        success?: boolean;
        data?: TorBoxTorrent[];
      };
      if (torrentData.success) {
        const torrents = torrentData.data || [];
        const musicTorrents = torrents.filter((t) => {
          const name = (t.name || '').toLowerCase();
          for (const pattern of VIDEO_PATTERNS) {
            if (pattern.test(name)) return false;
          }
          return true;
        });

        const torrentAlbums: CloudAlbum[] = musicTorrents.map((t) => ({
          id: 'torrent:' + t.id,
          hash: t.hash,
          name: t.name,
          size: t.size,
          created_at: t.created_at,
          download_state: t.download_state,
          parsed: parseTorrentName(t.name),
          provider: 'torbox',
          source: 'module',
          type: 'torrent',
        }));

        albums.push(...torrentAlbums);
      }
    }

    if (usenetResponse.status === 'fulfilled' && usenetResponse.value.ok) {
      const usenetData = (await usenetResponse.value.json()) as {
        success?: boolean;
        data?: TorBoxUsenet[];
      };
      if (usenetData.success) {
        const usenetDownloads = usenetData.data || [];
        const musicUsenet = usenetDownloads.filter((u) => {
          const name = (u.name || '').toLowerCase();
          for (const pattern of VIDEO_PATTERNS) {
            if (pattern.test(name)) return false;
          }
          return true;
        });

        const usenetAlbums: CloudAlbum[] = musicUsenet.map((u) => ({
          id: 'usenet:' + u.id,
          hash: u.hash,
          name: u.name,
          size: u.size,
          created_at: u.created_at,
          download_state: u.download_state,
          parsed: parseTorrentName(u.name),
          provider: 'torbox',
          source: 'module',
          type: 'usenet',
        }));

        albums.push(...usenetAlbums);
      }
    }

    albums.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    console.log('[MusicTorrent] Found', albums.length, 'cloud albums (torrents + usenet)');
    return { albums, provider: 'torbox' };
  } catch (e) {
    console.error('[MusicTorrent] Error fetching cloud albums:', e);
    throw e;
  }
}

async function getTorrentFiles(
  torrentId: string,
  context: ModuleContext
): Promise<Array<{ id: number; name: string; short_name: string; size: number }>> {
  if (torrentId.startsWith('usenet:')) {
    return await getUsenetFiles(torrentId.substring(7), context);
  }

  const cleanId = torrentId.startsWith('torrent:') ? torrentId.substring(8) : torrentId;
  const cacheKey = `files:${cleanId}`;
  const cached = getFromCache<Array<{ id: number; name: string; short_name: string; size: number }>>(cacheKey);

  if (cached) {
    console.log('[MusicTorrent] Using cached files for', cacheKey);
    return cached;
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const response = await fetch(TORBOX_API_BASE + '/torrents/mylist?id=' + cleanId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch torrent info: HTTP ' + response.status);
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: TorBoxTorrent };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Torrent not found');
    }

    const torrent = data.data;
    const files = torrent.files || [];

    const audioFiles = files
      .filter((f) => AUDIO_EXTENSIONS.test(f.name || f.short_name || ''))
      .map((f) => ({
        id: f.id,
        name: f.name || f.short_name || '',
        short_name: f.short_name || f.name || '',
        size: f.size,
      }));

    console.log('[MusicTorrent] Found', audioFiles.length, 'audio files in torrent');
    setCache(cacheKey, audioFiles);
    return audioFiles;
  } catch (e) {
    console.error('[MusicTorrent] Error fetching torrent files:', e);
    throw e;
  }
}

async function getUsenetFiles(
  usenetId: string,
  context: ModuleContext
): Promise<Array<{ id: number; name: string; short_name: string; size: number }>> {
  const cacheKey = `usenet-files:${usenetId}`;
  const cached = getFromCache<Array<{ id: number; name: string; short_name: string; size: number }>>(cacheKey);

  if (cached) {
    console.log('[MusicTorrent] Using cached usenet files for', cacheKey);
    return cached;
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const response = await fetch(TORBOX_API_BASE + '/usenet/mylist?id=' + usenetId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch usenet info: HTTP ' + response.status);
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: TorBoxUsenet };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Usenet download not found');
    }

    const usenetDownload = data.data;
    const files = usenetDownload.files || [];

    const audioFiles = files
      .filter((f) => AUDIO_EXTENSIONS.test(f.name || f.short_name || ''))
      .map((f) => ({
        id: f.id,
        name: f.name || f.short_name || '',
        short_name: f.short_name || f.name || '',
        size: f.size,
      }));

    console.log('[MusicTorrent] Found', audioFiles.length, 'audio files in usenet download');
    setCache(cacheKey, audioFiles);
    return audioFiles;
  } catch (e) {
    console.error('[MusicTorrent] Error fetching usenet files:', e);
    throw e;
  }
}

async function getUsenetFileStreamUrl(
  usenetId: string,
  fileId: string,
  context: ModuleContext
): Promise<string | null> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const params = new URLSearchParams({
      token: debrid.apiKey,
      usenet_id: usenetId,
      file_id: fileId,
    });

    const url = `${TORBOX_API_BASE}/usenet/requestdl?${params}`;
    console.log('[MusicTorrent] Requesting usenet download URL with params:', {
      usenet_id: usenetId,
      file_id: fileId,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        '[MusicTorrent] Initial request failed with status',
        response.status,
        ':',
        errorBody
      );

      const fallbackParams = new URLSearchParams({
        token: debrid.apiKey,
        usenet_id: usenetId,
        zip_link: 'true',
      });

      const fallbackUrl = `${TORBOX_API_BASE}/usenet/requestdl?${fallbackParams}`;
      const fallbackResp = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + debrid.apiKey,
        },
      });

      if (!fallbackResp.ok) {
        const fallbackError = await fallbackResp.text().catch(() => '');
        console.error(
          '[MusicTorrent] Fallback request failed with status',
          fallbackResp.status,
          ':',
          fallbackError
        );
        throw new Error(
          'HTTP ' +
            fallbackResp.status +
            ' - Fallback request (zip) failed to get usenet stream URL'
        );
      }

      const fallbackData = (await fallbackResp.json()) as { success?: boolean; data?: string };
      return fallbackData.success ? fallbackData.data || null : null;
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: string };

    if (!data.success) {
      throw new Error(data.detail || 'Failed to get usenet stream URL');
    }

    return data.data || null;
  } catch (e) {
    console.error('[MusicTorrent] Error getting usenet file stream URL:', e);
    throw e;
  }
}

async function getStreamUrl(
  torrentId: string,
  fileId: string,
  context: ModuleContext
): Promise<string | null> {
  if (torrentId.startsWith('usenet:')) {
    return await getUsenetFileStreamUrl(torrentId.substring(7), fileId, context);
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const cleanId = torrentId.startsWith('torrent:') ? torrentId.substring(8) : torrentId;

    const params = new URLSearchParams({
      token: debrid.apiKey,
      torrent_id: cleanId,
      file_id: fileId,
    });

    const url = `${TORBOX_API_BASE}/torrents/requestdl?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        '[MusicTorrent] Initial torrent request failed with status',
        response.status,
        ':',
        errorBody
      );

      const fallbackParams = new URLSearchParams({
        token: debrid.apiKey,
        torrent_id: cleanId,
        zip_link: 'true',
      });

      const fallbackUrl = `${TORBOX_API_BASE}/torrents/requestdl?${fallbackParams}`;
      const fallbackResp = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + debrid.apiKey,
        },
      });

      if (!fallbackResp.ok) {
        const fallbackError = await fallbackResp.text().catch(() => '');
        console.error(
          '[MusicTorrent] Fallback torrent request failed with status',
          fallbackResp.status,
          ':',
          fallbackError
        );
        throw new Error(
          'HTTP ' + fallbackResp.status + ' - Fallback request (zip) failed to get stream URL'
        );
      }

      const fallbackData = (await fallbackResp.json()) as { success?: boolean; data?: string };
      return fallbackData.success ? fallbackData.data || null : null;
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: string };

    if (!data.success) {
      throw new Error(data.detail || 'Failed to get stream URL');
    }

    return data.data || null;
  } catch (e) {
    console.error('[MusicTorrent] Error getting stream URL:', e);
    throw e;
  }
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

function getAlbum(): Promise<AlbumDetails> {
  throw new Error('Album browsing not supported by this module');
}

const module: Module8Spine = {
  id: 'music-torrent-search',
  name: 'Torrentio Music',
  author: 'Jawsh',
  version: '5.0.0',
  description: 'Search and stream audio from torrents and usenet (TorBox + Prowlarr)',
  logo: 'https://torrentioapk.com/wp-content/uploads/2025/09/cropped-Add-a-heading-9-scaled-1.webp',
  labels: ['GLOBAL', 'TORRENT', 'USENET', 'PROWLARR', 'MUSIC'],
  searchTracks,
  getTrackStreamUrl,
  getAlbum,
  addToCloud,
  verifyTorBoxKey,
  checkCached,
  getCloudAlbums,
  getTorrentFiles,
  getStreamUrl,
  settings: {
    torboxApiKey: {
      type: 'debrid',
      label: 'TorBox Connection',
      description:
        'Enter your TorBox API key to add torrents to your cloud. Get your key at torbox.app',
      provider: 'torbox',
      providerName: 'TorBox',
      providerLogo: TORBOX_LOGO,
      placeholder: 'Paste TorBox API Key...',
      verifyAction: 'verifyTorBoxKey',
    },
    searchSource: {
      type: 'selector',
      label: 'Search Source',
      description: 'Choose which sources to search for music',
      options: [
        { label: 'Torrents Only', value: 'torrents' },
        { label: 'Usenet (TorBox)', value: 'usenet-torbox' },
        { label: 'Usenet (Prowlarr)', value: 'usenet-prowlarr' },
        { label: 'All Sources', value: 'both' },
      ],
      defaultValue: 'torrents',
    },
    prowlarrUrl: {
      type: 'text',
      label: 'Prowlarr URL',
      description: 'Your Prowlarr instance URL (e.g., http://localhost:9696)',
      placeholder: 'http://localhost:9696',
      defaultValue: '',
    },
    prowlarrApiKey: {
      type: 'text',
      label: 'Prowlarr API Key',
      description: 'API key from Prowlarr Settings > General',
      placeholder: 'Enter Prowlarr API Key...',
      defaultValue: '',
    },
    preferredFormat: {
      type: 'selector',
      label: 'Preferred Format',
      description: 'Filter results by audio format',
      options: [
        { label: 'All Formats', value: '' },
        { label: 'FLAC', value: 'flac' },
        { label: 'MP3', value: 'mp3' },
        { label: 'WAV', value: 'wav' },
        { label: 'AAC', value: 'aac' },
        { label: 'OGG', value: 'ogg' },
      ],
      defaultValue: '',
    },
  },
};

export default module;
