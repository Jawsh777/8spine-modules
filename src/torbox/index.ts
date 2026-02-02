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

import type { Module8Spine, AlbumDetails } from '../../types';
import { TORBOX_LOGO } from './constants';
import { initCacheCleanup } from './utils';
import { verifyTorBoxKey } from './debrid';
import { checkCached } from './cache';
import { searchTracks } from './search';
import { addToCloud, getCloudAlbums, getTorrentFiles } from './cloud';
import { getTrackStreamUrl, getStreamUrl } from './stream';

// Re-export types for consumers
export type {
  TorrentTrack,
  TorrentSearchResult,
  CloudAlbum,
  VerifyResult,
  AudioFile,
} from './types';

// Initialize cache cleanup
initCacheCleanup();

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
