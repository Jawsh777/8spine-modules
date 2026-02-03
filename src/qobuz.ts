/**
 * Qobuz Module (via Squid.wtf)
 * High-quality music streaming from Qobuz API
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

const BASE_URL = 'https://qobuz.squid.wtf/api';

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

interface QobuzTrack {
  id: number;
  title: string;
  version?: string;
  duration: number;
  track_number?: number;
  performer?: {
    id: number;
    name: string;
  };
  album?: {
    qobuz_id: number;
    title: string;
    version?: string;
    image?: {
      large?: string;
      small?: string;
    };
  };
  maximum_technical_specifications?: string;
  maximum_bit_depth?: number;
  maximum_sampling_rate?: number;
  maximum_channel_count?: number;
}

interface QobuzSearchResponse {
  success: boolean;
  data?: {
    tracks?: {
      items: QobuzTrack[];
      total: number;
    };
  };
}

interface QobuzStreamResponse {
  success: boolean;
  data?: {
    url: string;
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function fetchJson<T>(endpoint: string): Promise<T> {
  const url = BASE_URL + endpoint;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Qobuz8Spine/1.0',
    },
  });

  if (!response.ok) {
    throw new Error('[Qobuz] HTTP ' + response.status);
  }

  return (await response.json()) as T;
}

function buildTrackTitle(track: QobuzTrack): string {
  if (!track) return 'Unknown Track';
  let title = track.title || 'Unknown Track';
  if (track.version) {
    title += ' (' + track.version + ')';
  }
  return title;
}

function buildAlbumTitle(album: QobuzTrack['album']): string {
  if (!album) return 'Unknown Album';
  let title = album.title || 'Unknown Album';
  if (album.version) {
    title += ' (' + album.version + ')';
  }
  return title;
}

function determineAudioQuality(track: QobuzTrack): string {
  if (!track) return 'Unknown';

  // Use maximum_technical_specifications if available
  if (track.maximum_technical_specifications) {
    return track.maximum_technical_specifications;
  }

  // Build quality string from individual fields
  const bitDepth = track.maximum_bit_depth || '?';
  const sampleRate = track.maximum_sampling_rate || '?';
  const channels = track.maximum_channel_count === 2 ? 'Stereo' : 'Unknown';

  return bitDepth + ' bits / ' + sampleRate + ' kHz - ' + channels;
}

// ============================================================================
// MODULE FUNCTIONS
// ============================================================================

async function searchTracks(
  query: string,
  limit: number = 50,
  context: ModuleContext
): Promise<SearchResult> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const data = await fetchJson<QobuzSearchResponse>(
      '/get-music?q=' + encodedQuery + '&offset=0'
    );

    // Check for successful response
    if (!data.success || !data.data) {
      console.error('[Qobuz] Invalid response structure');
      return { tracks: [], total: 0 };
    }

    // Extract tracks from nested structure
    const tracksData = data.data.tracks || { items: [], total: 0 };
    const items = tracksData.items || [];

    // Transform to standard track format
    const tracks: Track[] = items.map((track) => ({
      id: String(track.id),
      title: buildTrackTitle(track),
      artist: track.performer?.name || 'Unknown Artist',
      artistId: track.performer?.id ? String(track.performer.id) : undefined,
      album: buildAlbumTitle(track.album),
      albumId: track.album?.qobuz_id ? String(track.album.qobuz_id) : undefined,
      albumCover: track.album?.image?.large || track.album?.image?.small,
      duration: track.duration || 0,
      trackNumber: track.track_number,
      audioQuality: determineAudioQuality(track),
    }));

    return {
      tracks,
      total: tracksData.total || items.length,
    };
  } catch (error) {
    console.error('[Qobuz] Search failed:', error);
    throw error;
  }
}

async function getTrackStreamUrl(
  trackId: string,
  preferredQuality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  try {
    // Get quality from context settings
    const qualitySetting = context.settings?.quality;
    let quality =
      typeof qualitySetting === 'string' ? qualitySetting : qualitySetting?.value;

    // Default to Studio Master quality
    if (!quality) {
      quality = '27';
    }

    // Fetch the JSON response containing the stream URL
    const data = await fetchJson<QobuzStreamResponse>(
      '/download-music?track_id=' + trackId + '&quality=' + quality
    );

    // Check for successful response
    if (!data.success || !data.data) {
      throw new Error('[Qobuz] Failed to get stream URL');
    }

    // Extract the actual streaming URL from the nested data
    const streamUrl = data.data.url;

    if (!streamUrl) {
      throw new Error('[Qobuz] No stream URL found in response');
    }

    return {
      streamUrl,
      track: {
        id: trackId,
        audioQuality: 'Quality ' + quality,
      },
    };
  } catch (error) {
    console.error('[Qobuz] Get stream failed:', error);
    throw error;
  }
}

async function getAlbum(albumId: string): Promise<AlbumDetails> {
  // Album browsing not implemented for this API
  throw new Error('[Qobuz] Album browsing not available for this module');
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

const module = {
  id: 'qobuz',
  name: 'Qobuz (Squid.wtf)',
  author: 'Jawsh',
  version: '1.0.0',
  labels: ['Hi-Fi', 'Qobuz', 'Lossless'],
  description: 'High-quality music streaming from Qobuz via squid.wtf API',

  settings: {
    quality: {
      type: 'selector',
      label: 'Audio Quality',
      description: 'Select preferred streaming quality',
      options: [
        { label: 'Lossy', value: '5' },
        { label: 'Lossless', value: '27' },
      ],
      defaultValue: '27',
    },
  },

  searchTracks,
  getTrackStreamUrl,
  getAlbum,

  __meta: {
    type: 'MODULE',
    category: 'modules',
    exportName: 'QOBUZ_MODULE_CODE',
    featured: false,
    trusted: true,
    nsfw: false,
  },
} as const satisfies Module8SpineFull;

export default module;
