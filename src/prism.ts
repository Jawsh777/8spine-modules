/**
 * Prism Module
 * Stream music from YouTube Music via Piped API
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

const LOG_PREFIX = '[Prism]';

// Fallback Piped API instances (used if dynamic fetch fails)
const FALLBACK_PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://api.piped.yt',
];

// Instance list URL from Piped documentation
const INSTANCES_WIKI_URL =
  'https://raw.githubusercontent.com/TeamPiped/documentation/refs/heads/main/content/docs/public-instances/index.md';

// Cache for dynamically fetched instances
let cachedInstances: string[] | null = null;
let instancesFetchedAt = 0;
const INSTANCES_CACHE_TTL = 1000 * 60 * 60; // 1 hour

// ============================================================================
// TYPES
// ============================================================================

// Piped API search response types
interface PipedSearchResponse {
  items: PipedStreamItem[];
  nextpage?: string;
  suggestion?: string;
  corrected?: boolean;
}

interface PipedStreamItem {
  url: string; // e.g., "/watch?v=VIDEO_ID"
  title: string;
  thumbnail: string;
  uploaderName: string;
  uploaderUrl?: string;
  uploaderAvatar?: string;
  uploadedDate?: string;
  duration: number; // seconds
  views?: number;
  uploaded?: number;
  uploaderVerified?: boolean;
  isShort?: boolean;
}

// Piped API response types
interface PipedAudioStream {
  bitrate: number;
  codec: string;
  format: string;
  mimeType: string;
  quality: string;
  url: string;
  videoOnly: boolean;
}

interface PipedStreamResponse {
  audioStreams: PipedAudioStream[];
  title: string;
  duration: number;
  uploaderName?: string;
  thumbnailUrl?: string;
}

// ============================================================================
// PIPED API HELPERS
// ============================================================================

/**
 * Fetch and parse Piped instances from the GitHub wiki
 */
async function fetchPipedInstances(): Promise<string[]> {
  const now = Date.now();

  // Return cached instances if still valid
  if (cachedInstances && now - instancesFetchedAt < INSTANCES_CACHE_TTL) {
    return cachedInstances;
  }

  try {
    const response = await fetch(INSTANCES_WIKI_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const body = await response.text();
    const instances: string[] = [];
    let skipped = 0;

    for (const line of body.split('\n')) {
      const split = line.split('|');
      // New format has 5 columns: Name | API URL | Locations | CDN | Registered Users
      if (split.length === 5) {
        // Skip header row and separator row (---)
        if (skipped < 2) {
          skipped++;
          continue;
        }
        const apiUrl = split[1].trim();
        if (apiUrl && apiUrl.startsWith('https://')) {
          instances.push(apiUrl);
        }
      }
    }

    if (instances.length > 0) {
      cachedInstances = instances;
      instancesFetchedAt = now;
      console.log(LOG_PREFIX, `Fetched ${instances.length} Piped instances`);
      return instances;
    }
  } catch (err) {
    console.warn(LOG_PREFIX, 'Failed to fetch instances:', err);
  }

  // Fall back to hardcoded instances
  return FALLBACK_PIPED_INSTANCES;
}

/**
 * Make a request to Piped API with failover to multiple instances
 */
async function pipedFetch<T>(path: string): Promise<T> {
  const instances = await fetchPipedInstances();
  const errors: string[] = [];

  for (const instance of instances) {
    try {
      const response = await fetch(`${instance}${path}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; 8spine/1.0)',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        errors.push(`${instance}: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        continue;
      }

      return response.json() as Promise<T>;
    } catch (err) {
      errors.push(`${instance}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All Piped instances failed:\n${errors.join('\n')}`);
}

/**
 * Search for music tracks via Piped API
 */
async function pipedSearch(query: string): Promise<PipedSearchResponse> {
  const encodedQuery = encodeURIComponent(query);
  return pipedFetch<PipedSearchResponse>(`/search?q=${encodedQuery}&filter=music_songs`);
}

/**
 * Get stream info for a video
 */
async function pipedGetStreams(videoId: string): Promise<PipedStreamResponse> {
  return pipedFetch<PipedStreamResponse>(`/streams/${videoId}`);
}

/**
 * Select the best audio stream from Piped response
 */
function selectBestPipedAudio(streams: PipedAudioStream[]): PipedAudioStream | null {
  if (!streams || streams.length === 0) return null;

  // Filter to audio-only streams (not video-only)
  const audioStreams = streams.filter((s) => !s.videoOnly);

  if (audioStreams.length === 0) return null;

  // Sort by bitrate (highest first)
  audioStreams.sort((a, b) => b.bitrate - a.bitrate);

  return audioStreams[0] || null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract video ID from Piped URL (e.g., "/watch?v=VIDEO_ID" -> "VIDEO_ID")
 */
function extractVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

/**
 * Convert a Piped stream item to a Track
 */
function streamItemToTrack(item: PipedStreamItem): Track | null {
  const videoId = extractVideoId(item.url);
  if (!videoId) return null;

  return {
    id: videoId,
    title: item.title,
    artist: item.uploaderName,
    album: '', // Piped doesn't provide album info in search results
    albumCover: item.thumbnail,
    duration: item.duration,
    audioQuality: 'YouTube Music',
  };
}

// ============================================================================
// MODULE FUNCTIONS
// ============================================================================

async function searchTracks(
  query: string,
  limit: number = 25,
  _context: ModuleContext
): Promise<SearchResult> {
  try {
    const response = await pipedSearch(query);

    const tracks: Track[] = [];

    for (const item of response.items) {
      if (tracks.length >= limit) break;

      const track = streamItemToTrack(item);
      if (track) {
        tracks.push(track);
      }
    }

    return {
      tracks,
      total: tracks.length,
      source: 'YouTube Music',
    };
  } catch (error) {
    console.error(LOG_PREFIX, 'Search failed:', error);
    throw error;
  }
}

async function getTrackStreamUrl(
  trackId: string,
  _preferredQuality: QualityPreference,
  _context: ModuleContext
): Promise<StreamResult> {
  try {
    // Use Piped API to get stream URLs (handles YouTube auth internally)
    const pipedResponse = await pipedGetStreams(trackId);

    const bestAudio = selectBestPipedAudio(pipedResponse.audioStreams);

    if (!bestAudio) {
      throw new Error('No audio streams available');
    }

    // Build audio quality string from Piped response
    const bitrate = bestAudio.bitrate ? Math.round(bestAudio.bitrate / 1000) : null;
    const audioQuality = bitrate
      ? `${bestAudio.codec} @ ${bitrate}kbps`
      : bestAudio.quality || 'Unknown';

    return {
      streamUrl: bestAudio.url,
      track: {
        id: trackId,
        duration: pipedResponse.duration,
        audioQuality,
      },
    };
  } catch (error) {
    console.error(LOG_PREFIX, 'Get stream URL failed:', error);
    throw error;
  }
}

async function getAlbum(_albumId: string): Promise<AlbumDetails> {
  throw new Error(LOG_PREFIX + ' Album browsing not implemented');
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

const module = {
  id: 'prism',
  name: 'Prism',
  author: 'Jawsh',
  version: '1.1.0',
  labels: ['YouTube Music', 'STREAMING', 'MUSIC'],
  description: 'Stream music from YouTube Music',

  searchTracks,
  getTrackStreamUrl,
  getAlbum,

  __meta: {
    type: 'MODULE',
    category: 'modules',
    exportName: 'PRISM_MODULE_CODE',
    featured: false,
    trusted: true,
    nsfw: false,
  },
} as const satisfies Module8SpineFull;

export default module;
