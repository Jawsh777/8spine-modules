/**
 * Prism Module
 * Stream music from YouTube Music via direct InnerTube API calls
 *
 * Uses cipher.kikkia.dev for signature decryption (iOS 12 compatible)
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

// YouTube Music InnerTube API (for search)
const INNERTUBE_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const INNERTUBE_BASE_URL = 'https://music.youtube.com/youtubei/v1';

// Piped API instances (for stream URLs - handles YouTube auth internally)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://api.piped.yt',
];

// Client context for search (InnerTube)
const WEB_REMIX_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250219.01.00',
    hl: 'en',
    gl: 'US',
  },
};

// Search params for filtering songs only
const SEARCH_SONGS_PARAMS = 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D';

// ============================================================================
// TYPES
// ============================================================================

interface InnertubeSearchResponse {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicShelfRenderer?: {
                  contents?: Array<{
                    musicResponsiveListItemRenderer?: MusicListItemRenderer;
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

interface MusicListItemRenderer {
  flexColumns?: Array<{
    musicResponsiveListItemFlexColumnRenderer?: {
      text?: {
        runs?: Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }>;
      };
    };
  }>;
  playlistItemData?: {
    videoId?: string;
  };
  thumbnail?: {
    musicThumbnailRenderer?: {
      thumbnail?: {
        thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
      };
    };
  };
  fixedColumns?: Array<{
    musicResponsiveListItemFixedColumnRenderer?: {
      text?: {
        runs?: Array<{ text?: string }>;
      };
    };
  }>;
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
// INNERTUBE API HELPERS (for search)
// ============================================================================

/**
 * Search YouTube Music for tracks via InnerTube API
 */
async function innertubeSearch(query: string): Promise<InnertubeSearchResponse> {
  const url = `${INNERTUBE_BASE_URL}/search?key=${INNERTUBE_API_KEY}&prettyPrint=false`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': '67',
      'X-Youtube-Client-Version': WEB_REMIX_CONTEXT.client.clientVersion,
      'User-Agent': 'Mozilla/5.0 (compatible; 8spine/1.0)',
    },
    body: JSON.stringify({
      context: WEB_REMIX_CONTEXT,
      query,
      params: SEARCH_SONGS_PARAMS,
    }),
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore if we can't read the body
    }
    throw new Error(`InnerTube search error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  return response.json() as Promise<InnertubeSearchResponse>;
}

// ============================================================================
// PIPED API (for stream URLs)
// ============================================================================

/**
 * Get stream info from Piped API with failover to multiple instances
 */
async function pipedGetStreams(videoId: string): Promise<PipedStreamResponse> {
  const errors: string[] = [];

  for (const instance of PIPED_INSTANCES) {
    try {
      const response = await fetch(`${instance}/streams/${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; 8spine/1.0)',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        errors.push(`${instance}: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        continue;
      }

      return response.json() as Promise<PipedStreamResponse>;
    } catch (err) {
      errors.push(`${instance}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All Piped instances failed:\n${errors.join('\n')}`);
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
 * Extract the best thumbnail URL from thumbnails array
 */
function extractThumbnailUrl(thumbnails?: Array<{ url?: string; width?: number }>): string | undefined {
  if (!thumbnails || thumbnails.length === 0) return undefined;
  // Get the highest resolution thumbnail (usually last in array)
  const best = thumbnails[thumbnails.length - 1];
  return best?.url;
}

/**
 * Parse duration string (e.g., "3:45") to seconds
 */
function parseDuration(durationStr?: string): number {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }
  return 0;
}

/**
 * Extract track info from a music list item renderer
 */
function extractTrackFromRenderer(renderer: MusicListItemRenderer): Track | null {
  const videoId = renderer.playlistItemData?.videoId;
  if (!videoId) return null;

  const flexColumns = renderer.flexColumns || [];

  // Title is usually in the first column
  const titleColumn = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer;
  const title = titleColumn?.text?.runs?.[0]?.text || 'Unknown Track';

  // Artist is usually in the second column
  const artistColumn = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer;
  const artistRuns = artistColumn?.text?.runs || [];
  const artist = artistRuns[0]?.text || 'Unknown Artist';
  const artistId = artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId;

  // Album might be in the runs after the artist (separated by bullet)
  let album = '';
  let albumId: string | undefined;
  for (let i = 2; i < artistRuns.length; i++) {
    const run = artistRuns[i];
    if (run?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPREb')) {
      album = run.text || '';
      albumId = run.navigationEndpoint.browseEndpoint.browseId;
      break;
    }
  }

  // Duration might be in fixed columns
  const durationColumn = renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer;
  const durationStr = durationColumn?.text?.runs?.[0]?.text;
  const duration = parseDuration(durationStr);

  // Thumbnail
  const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
  const albumCover = extractThumbnailUrl(thumbnails);

  return {
    id: videoId,
    title,
    artist,
    artistId,
    album,
    albumId,
    albumCover,
    duration,
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
    const response = await innertubeSearch(query);

    // Navigate to the search results
    const tabs = response.contents?.tabbedSearchResultsRenderer?.tabs || [];
    const firstTab = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    const tracks: Track[] = [];

    for (const section of firstTab) {
      const shelfContents = section.musicShelfRenderer?.contents || [];

      for (const item of shelfContents) {
        if (tracks.length >= limit) break;

        const renderer = item.musicResponsiveListItemRenderer;
        if (!renderer) continue;

        const track = extractTrackFromRenderer(renderer);
        if (track) {
          tracks.push(track);
        }
      }

      if (tracks.length >= limit) break;
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
