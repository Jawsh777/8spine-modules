/**
 * Cerberus Module
 * Three-headed guardian of Tidal streams - races 3 random endpoints for fastest, most reliable access
 */

import type {
  Module8SpineFull,
  Track,
  SearchResult,
  StreamResult,
  AlbumDetails,
  ModuleContext,
  QualityPreference,
} from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

const LOG_PREFIX = '[Cerberus]';

const DEFAULTS = {
  ARTIST: 'Unknown Artist',
  ALBUM: 'Unknown Album',
  QUALITY: 'Unknown Quality',
};

const TIDAL_COVER = {
  BASE_URL: 'https://resources.tidal.com/images/',
  SIZE: '640x640.jpg',
};

const HTTP_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': '8spine/1.0',
};

const ENDPOINTS = [
  'https://tidal.squid.wtf',
  'https://triton.squid.wtf',
  'https://tidal.kinoplus.online',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site',
  'https://tidal-api.binimum.org',
  'https://aether.squid.wtf',
  'https://zeus.squid.wtf',
  'https://kraken.squid.wtf',
  'https://phoenix.squid.wtf',
  'https://shiva.squid.wtf',
  'https://chaos.squid.wtf',
  'https://hifi-one.spotisaver.net',
  'https://hifi-two.spotisaver.net',
  'https://monochrome.samidy.com',
  'https://monochrome-api.samidy.com',
  'https://music.binimum.org',
  'https://tidal.qqdl.site',
  'https://music.arjix.dev',
  'https://spo.free.nf',
];

const RACE_SIZE = 3;

const QUALITY = {
  LOW: 'LOW',
  HIGH: 'HIGH',
  LOSSLESS: 'LOSSLESS',
  HI_RES_LOSSLESS: 'HI_RES_LOSSLESS',
} as const;

type QualityLevel = (typeof QUALITY)[keyof typeof QUALITY];

const QUALITY_OPTIONS = [
  { label: 'Data Saver', value: QUALITY.LOW },
  { label: 'High Quality', value: QUALITY.HIGH },
  { label: 'Lossless', value: QUALITY.LOSSLESS },
  { label: 'Hi-Res Lossless', value: QUALITY.HI_RES_LOSSLESS },
];

const FALLBACK_MODE = {
  FLEXIBLE: 'flexible',
  STRICT: 'strict',
} as const;

type FallbackModeType = (typeof FALLBACK_MODE)[keyof typeof FALLBACK_MODE];

const FALLBACK_MODE_OPTIONS = [
  { label: 'Flexible', value: FALLBACK_MODE.FLEXIBLE },
  { label: 'Strict', value: FALLBACK_MODE.STRICT },
];

const QUALITY_FALLBACKS: Record<QualityLevel, QualityLevel[]> = {
  [QUALITY.LOW]: [QUALITY.HIGH, QUALITY.LOSSLESS, QUALITY.HI_RES_LOSSLESS],
  [QUALITY.HIGH]: [QUALITY.LOSSLESS, QUALITY.HI_RES_LOSSLESS, QUALITY.LOW],
  [QUALITY.LOSSLESS]: [QUALITY.HIGH, QUALITY.HI_RES_LOSSLESS, QUALITY.LOW],
  [QUALITY.HI_RES_LOSSLESS]: [QUALITY.LOSSLESS, QUALITY.HIGH, QUALITY.LOW],
};

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

interface TidalArtist {
  id: number;
  name: string;
}

interface TidalAlbum {
  id: number;
  title: string;
  cover?: string;
}

interface TidalTrack {
  id: number;
  title: string;
  artist?: TidalArtist;
  artists?: TidalArtist[];
  album?: TidalAlbum;
  duration?: number;
  trackNumber?: number;
  audioQuality?: string;
}

interface TidalSearchResponse {
  version: string;
  data?: {
    items: TidalTrack[];
    totalNumberOfItems?: number;
  };
}

interface TidalStreamData {
  trackId?: number;
  manifest?: string;
  audioQuality?: string;
  bitDepth?: number;
  sampleRate?: number;
}

interface TidalStreamResponse {
  version: string;
  data?: TidalStreamData;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function pickRandomEndpoints(endpoints: string[], count: number): string[] {
  const shuffled = [...endpoints].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function fetchWithRace<T>(endpoint: string): Promise<T> {
  const tried = new Set<string>();

  while (tried.size < ENDPOINTS.length) {
    const available = ENDPOINTS.filter((e) => !tried.has(e));
    const batchSize = Math.min(RACE_SIZE, available.length);

    if (batchSize === 0) break;

    const batch = pickRandomEndpoints(available, batchSize);
    batch.forEach((e) => tried.add(e));

    console.log(
      LOG_PREFIX,
      'Racing endpoints:',
      batch.map((u) => new URL(u).hostname).join(', ')
    );

    try {
      const result = await Promise.any(
        batch.map((baseUrl) =>
          fetch(baseUrl + endpoint, {
            headers: HTTP_HEADERS,
          }).then((response) => {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status);
            }
            return response.json() as Promise<T>;
          })
        )
      );
      return result;
    } catch (e) {
      console.warn(LOG_PREFIX, 'Batch failed, trying next batch...');
    }
  }

  throw new Error('All endpoints failed');
}

function extractStreamUrl(manifest: string): string | null {
  if (!manifest) return null;
  try {
    const decoded = atob(manifest);
    const parsed = JSON.parse(decoded) as { urls?: string[] };

    if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
      return parsed.urls[0];
    }
  } catch (error) {
    console.error(LOG_PREFIX, 'Failed to decode manifest:', error);
  }
  return null;
}

function getTidalCoverUrl(uuid: string | undefined): string | null {
  if (!uuid || typeof uuid !== 'string') return null;
  if (uuid.startsWith('http')) return uuid;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return uuid;
  }
  const path = uuid.replace(/-/g, '/');
  return TIDAL_COVER.BASE_URL + path + '/' + TIDAL_COVER.SIZE;
}

// ============================================================================
// MODULE FUNCTIONS
// ============================================================================

async function searchTracks(
  query: string,
  limit: number = 25,
  context: ModuleContext
): Promise<SearchResult> {
  try {
    const data = await fetchWithRace<TidalSearchResponse>(
      '/search/?s=' + encodeURIComponent(query) + '&limit=' + limit
    );

    const items = data.data?.items || [];

    const tracks: Track[] = items.map((track) => ({
      id: String(track.id),
      title: track.title,
      artist: track.artist?.name || track.artists?.[0]?.name || DEFAULTS.ARTIST,
      artistId: track.artist?.id ? String(track.artist.id) : track.artists?.[0]?.id ? String(track.artists[0].id) : undefined,
      album: track.album?.title || DEFAULTS.ALBUM,
      albumId: track.album?.id ? String(track.album.id) : undefined,
      albumCover: getTidalCoverUrl(track.album?.cover) || undefined,
      duration: track.duration || 0,
      trackNumber: track.trackNumber,
      audioQuality: track.audioQuality || DEFAULTS.QUALITY,
    }));

    return {
      tracks,
      total: data.data?.totalNumberOfItems || items.length,
    };
  } catch (error) {
    console.error(LOG_PREFIX, 'Search failed:', error);
    throw error;
  }
}

async function fetchStreamWithQuality(trackId: string, quality: QualityLevel): Promise<StreamResult> {
  const data = await fetchWithRace<TidalStreamResponse>(
    '/track/?id=' + trackId + '&quality=' + quality
  );

  const trackData = data.data;

  if (!trackData || !trackData.manifest) {
    throw new Error('No manifest found in response');
  }

  const streamUrl = extractStreamUrl(trackData.manifest);
  if (!streamUrl) {
    throw new Error('Failed to extract stream URL from manifest');
  }

  return {
    streamUrl,
    track: {
      id: trackData.trackId ? String(trackData.trackId) : trackId,
      audioQuality: trackData.audioQuality,
      bitDepth: trackData.bitDepth?.toString(),
      sampleRate: trackData.sampleRate?.toString(),
    },
  };
}

async function getTrackStreamUrl(
  trackId: string,
  preferredQuality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  const qualitySetting = context?.settings?.quality;
  const quality = (typeof qualitySetting === 'string' ? qualitySetting : qualitySetting?.value) as QualityLevel || QUALITY.LOSSLESS;

  const fallbackModeSetting = context?.settings?.fallbackMode;
  const fallbackMode = (typeof fallbackModeSetting === 'string' ? fallbackModeSetting : fallbackModeSetting?.value) as FallbackModeType || FALLBACK_MODE.FLEXIBLE;

  const qualitiesToTry: QualityLevel[] =
    fallbackMode === FALLBACK_MODE.STRICT
      ? [quality]
      : [quality, ...(QUALITY_FALLBACKS[quality] || [])];

  let lastError: Error | undefined;
  for (const q of qualitiesToTry) {
    try {
      const result = await fetchStreamWithQuality(trackId, q);
      if (q !== quality) {
        console.warn(LOG_PREFIX, quality + ' unavailable, using ' + q);
      }
      return result;
    } catch (e) {
      const hasMoreQualities = qualitiesToTry.indexOf(q) < qualitiesToTry.length - 1;
      console.warn(LOG_PREFIX, q + ' failed' + (hasMoreQualities ? ', trying next...' : ''));
      lastError = e as Error;
    }
  }

  throw lastError || new Error('All quality levels failed');
}

async function getAlbum(albumId: string): Promise<AlbumDetails> {
  throw new Error('Album fetch not fully implemented for Cerberus');
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

const module = {
  id: 'cerberus',
  name: 'Cerberus',
  author: 'Jawsh',
  version: '1.0.0',
  labels: ['Tidal', 'High Quality', 'Multi-Endpoint', 'Reliable'],
  description:
    'Three-headed guardian of Tidal streams. Races 3 random endpoints for fastest, most reliable access.',

  settings: {
    quality: {
      type: 'selector',
      label: 'Audio Quality',
      description: 'Select preferred streaming quality for tracks',
      options: QUALITY_OPTIONS,
      defaultValue: QUALITY.LOSSLESS,
    },
    fallbackMode: {
      type: 'selector',
      label: 'Quality Fallback',
      description: 'What to do when preferred quality is unavailable',
      options: FALLBACK_MODE_OPTIONS,
      defaultValue: FALLBACK_MODE.FLEXIBLE,
    },
  },

  searchTracks,
  getTrackStreamUrl,
  getAlbum,

  __meta: {
    type: 'MODULE',
    category: 'modules',
    exportName: 'CERBERUS_MODULE_CODE',
    featured: false,
    trusted: true,
    nsfw: false,
  },
} as const satisfies Module8SpineFull;

export default module;
