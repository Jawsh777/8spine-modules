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

// YouTube Music InnerTube API
const INNERTUBE_API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const INNERTUBE_BASE_URL = 'https://music.youtube.com/youtubei/v1';

// Cipher decryption service
const CIPHER_SERVICE_URL = 'https://cipher.kikkia.dev';

// Android User Agent (required for ANDROID_MUSIC client)
const ANDROID_USER_AGENT = 'com.google.android.youtube/19.35.36(Linux; U; Android 13; en_US; SM-S908E Build/TP1A.220624.014) gzip';

// Client contexts for different API calls
const WEB_REMIX_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20250219.01.00',
    hl: 'en',
    gl: 'US',
  },
};

const ANDROID_MUSIC_CONTEXT = {
  client: {
    clientName: 'ANDROID_MUSIC',
    clientVersion: '5.34.51',
    androidSdkVersion: 33,
    hl: 'en',
    gl: 'US',
    osName: 'Android',
    osVersion: '13',
    platform: 'MOBILE',
    clientFormFactor: 'SMALL_FORM_FACTOR',
    userAgent: ANDROID_USER_AGENT,
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

interface InnertubePlayerResponse {
  streamingData?: {
    adaptiveFormats?: Array<{
      itag?: number;
      mimeType?: string;
      bitrate?: number;
      audioQuality?: string;
      audioSampleRate?: string;
      url?: string;
      signatureCipher?: string;
    }>;
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    thumbnail?: {
      thumbnails?: Array<{ url?: string }>;
    };
  };
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
}

interface CipherDecryptResponse {
  decrypted_signature?: string;
  decrypted_n?: string;
}

type AudioFormat = {
  itag?: number;
  mimeType?: string;
  bitrate?: number;
  audioQuality?: string;
  audioSampleRate?: string;
  url?: string;
  signatureCipher?: string;
};

// ============================================================================
// INNERTUBE API HELPERS
// ============================================================================

/**
 * Make a POST request to the InnerTube API
 */
async function innertubeRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
  context: typeof WEB_REMIX_CONTEXT | typeof ANDROID_MUSIC_CONTEXT = WEB_REMIX_CONTEXT
): Promise<T> {
  const url = `${INNERTUBE_BASE_URL}/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`;

  const isAndroid = context.client.clientName === 'ANDROID_MUSIC';

  // Build headers based on client type
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Youtube-Client-Name': isAndroid ? '21' : '67', // 21 = ANDROID_MUSIC, 67 = WEB_REMIX
    'X-Youtube-Client-Version': context.client.clientVersion,
  };

  if (isAndroid) {
    headers['User-Agent'] = ANDROID_USER_AGENT;
    headers['X-GOOG-API-FORMAT-VERSION'] = '2';
  } else {
    headers['User-Agent'] = 'Mozilla/5.0 (compatible; 8spine/1.0)';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context,
      ...body,
    }),
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore if we can't read the body
    }
    throw new Error(`InnerTube API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Search YouTube Music for tracks
 */
async function innertubeSearch(query: string): Promise<InnertubeSearchResponse> {
  return innertubeRequest<InnertubeSearchResponse>('search', {
    query,
    params: SEARCH_SONGS_PARAMS,
  }, WEB_REMIX_CONTEXT);
}

/**
 * Get player info for a video
 */
async function innertubePlayer(videoId: string): Promise<InnertubePlayerResponse> {
  return innertubeRequest<InnertubePlayerResponse>('player', {
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  }, ANDROID_MUSIC_CONTEXT);
}

// ============================================================================
// CIPHER DECRYPTION
// ============================================================================

/**
 * Parse signature cipher string into components
 */
function parseSignatureCipher(cipherString: string): {
  signature: string;
  signatureParam: string;
  url: string;
  nParam?: string;
} {
  const params = new URLSearchParams(cipherString);
  const url = params.get('url') || '';
  const signature = params.get('s') || '';
  const signatureParam = params.get('sp') || 'sig';

  // Extract n parameter from the URL
  const urlParams = new URLSearchParams(url.split('?')[1] || '');
  const nParam = urlParams.get('n') || undefined;

  return { signature, signatureParam, url, nParam };
}

/**
 * Get the current YouTube player URL (needed for cipher decryption)
 */
async function getPlayerUrl(): Promise<string> {
  // Fetch YouTube homepage to extract player URL
  const response = await fetch('https://www.youtube.com/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; 8spine/1.0)',
    },
  });

  const html = await response.text();

  // Extract player URL from the page
  const playerMatch = html.match(/\/s\/player\/([^\/]+)\/player_ias\.vflset\/[^\/]+\/base\.js/);
  if (playerMatch) {
    return `https://www.youtube.com${playerMatch[0]}`;
  }

  // Fallback pattern
  const altMatch = html.match(/"jsUrl":"([^"]+base\.js)"/);
  if (altMatch) {
    return altMatch[1].startsWith('http') ? altMatch[1] : `https://www.youtube.com${altMatch[1]}`;
  }

  throw new Error('Could not extract player URL');
}

/**
 * Decrypt signature using cipher.kikkia.dev service
 */
async function decryptSignature(
  encryptedSignature: string,
  nParam: string | undefined,
  playerUrl: string
): Promise<CipherDecryptResponse> {
  const response = await fetch(`${CIPHER_SERVICE_URL}/decrypt_signature`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      encrypted_signature: encryptedSignature,
      n_param: nParam || '',
      player_url: playerUrl,
    }),
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore if we can't read the body
    }
    throw new Error(`Cipher service error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  return response.json() as Promise<CipherDecryptResponse>;
}

/**
 * Build the final stream URL with decrypted signature
 */
function buildStreamUrl(
  baseUrl: string,
  signatureParam: string,
  decryptedSignature: string,
  decryptedN?: string
): string {
  let url = baseUrl;

  // Add decrypted signature
  url += `&${signatureParam}=${encodeURIComponent(decryptedSignature)}`;

  // Replace n parameter if we have a decrypted version
  if (decryptedN) {
    url = url.replace(/&n=[^&]+/, `&n=${encodeURIComponent(decryptedN)}`);
  }

  return url;
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

/**
 * Select the best audio format from available formats
 */
function selectBestAudioFormat(formats: AudioFormat[] | undefined): AudioFormat | null {
  if (!formats || formats.length === 0) return null;

  // Filter to audio-only formats
  const audioFormats = formats.filter((f) => f.mimeType?.startsWith('audio/'));

  if (audioFormats.length === 0) return null;

  // Sort by bitrate (highest first)
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return audioFormats[0] || null;
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
    const playerResponse = await innertubePlayer(trackId);

    // Check playability
    if (playerResponse.playabilityStatus?.status !== 'OK') {
      throw new Error(
        playerResponse.playabilityStatus?.reason || 'Video not playable'
      );
    }

    const formats = playerResponse.streamingData?.adaptiveFormats;
    const bestFormat = selectBestAudioFormat(formats);

    if (!bestFormat) {
      throw new Error('No audio formats available');
    }

    let streamUrl: string;

    if (bestFormat.url) {
      // Direct URL available (no cipher)
      streamUrl = bestFormat.url;
    } else if (bestFormat.signatureCipher) {
      // Need to decrypt signature
      const cipher = parseSignatureCipher(bestFormat.signatureCipher);
      const playerUrl = await getPlayerUrl();

      const decrypted = await decryptSignature(
        cipher.signature,
        cipher.nParam,
        playerUrl
      );

      if (!decrypted.decrypted_signature) {
        throw new Error('Failed to decrypt signature');
      }

      streamUrl = buildStreamUrl(
        cipher.url,
        cipher.signatureParam,
        decrypted.decrypted_signature,
        decrypted.decrypted_n
      );
    } else {
      throw new Error('No stream URL or cipher available');
    }

    // Build audio quality string
    const bitrate = bestFormat.bitrate ? Math.round(bestFormat.bitrate / 1000) : null;
    const audioQuality = bitrate
      ? `${bestFormat.audioQuality || 'Audio'} @ ${bitrate}kbps`
      : bestFormat.audioQuality || 'Unknown';

    return {
      streamUrl,
      track: {
        id: trackId,
        duration: parseInt(playerResponse.videoDetails?.lengthSeconds || '0', 10),
        audioQuality,
        sampleRate: bestFormat.audioSampleRate,
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
