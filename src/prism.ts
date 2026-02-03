/**
 * Prism Module
 * Stream music from YouTube Music via the InnerTube API
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

import { Innertube } from 'youtubei.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const LOG_PREFIX = '[Prism]';

// ============================================================================
// INNERTUBE INITIALIZATION (lazy singleton)
// ============================================================================

let innertubeInstance: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
  if (!innertubeInstance) {
    innertubeInstance = await Innertube.create();
  }
  return innertubeInstance;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract the best thumbnail URL from a YouTube Music item
 */
function extractThumbnailUrl(item: any): string | undefined {
  // Try different thumbnail locations
  const thumbnails =
    item.thumbnail?.contents ||
    item.thumbnails ||
    item.thumbnail;

  if (Array.isArray(thumbnails) && thumbnails.length > 0) {
    // Get the highest resolution thumbnail (usually last in array)
    return thumbnails[thumbnails.length - 1]?.url;
  }

  // Handle single thumbnail object
  if (thumbnails?.url) {
    return thumbnails.url;
  }

  return undefined;
}

/**
 * Format duration from seconds to readable string
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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
    const yt = await getInnertube();
    const search = await yt.music.search(query, { type: 'song' });

    // Access the songs shelf
    const songsShelf = search.songs;
    const items = songsShelf?.contents || [];

    // Transform to standard track format
    const tracks: Track[] = items
      .filter((item: any) => item.id) // Only include items with valid IDs
      .slice(0, limit)
      .map((item: any) => ({
        id: item.id || '',
        title: item.title?.toString() || 'Unknown Track',
        artist: item.artists?.[0]?.name || 'Unknown Artist',
        artistId: item.artists?.[0]?.channel_id,
        album: item.album?.name || '',
        albumId: item.album?.id,
        albumCover: extractThumbnailUrl(item),
        duration: item.duration?.seconds || 0,
        audioQuality: 'YouTube Music',
      }));

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
  preferredQuality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  try {
    const yt = await getInnertube();

    // Fetch track info using the Music client
    const trackInfo = await yt.music.getInfo(trackId);

    // Choose best audio format
    const format = trackInfo.chooseFormat({
      type: 'audio',
      quality: 'best',
    });

    // Get the stream URL
    const streamUrl = await format.decipher(yt.session.player);

    if (!streamUrl) {
      throw new Error('Failed to get stream URL');
    }

    // Build audio quality string
    const bitrate = format.bitrate ? Math.round(format.bitrate / 1000) : null;
    const audioQuality = bitrate
      ? `${format.audio_quality || 'Audio'} @ ${bitrate}kbps`
      : format.audio_quality || 'Unknown';

    return {
      streamUrl,
      track: {
        id: trackId,
        duration: trackInfo.basic_info.duration,
        audioQuality,
        sampleRate: format.audio_sample_rate?.toString(),
      },
    };
  } catch (error) {
    console.error(LOG_PREFIX, 'Get stream URL failed:', error);
    throw error;
  }
}

async function getAlbum(albumId: string): Promise<AlbumDetails> {
  throw new Error(LOG_PREFIX + ' Album browsing not implemented');
}

// ============================================================================
// MODULE EXPORT
// ============================================================================

const module = {
  id: 'prism',
  name: 'Prism',
  author: 'Jawsh',
  version: '1.0.0',
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
