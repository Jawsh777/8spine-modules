/**
 * Constants for the TorBox module
 */

export const MUSIC_API_BASE = 'https://torrentio-addon-626866336386.europe-west4.run.app/music';
export const TORBOX_API_BASE = 'https://api.torbox.app/v1/api';
export const TORBOX_SEARCH_API_BASE = 'https://search-api.torbox.app';
export const REALDEBRID_API_BASE = 'https://api.real-debrid.com/rest/1.0';

export const CONFIG = {
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
} as const;

export const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://zer0day.ch:1337/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://p4p.arenabg.com:1337/announce',
];

export const TORBOX_LOGO = 'https://avatars.githubusercontent.com/u/144096078?s=280&v=4';

export const ERRORS = {
  NO_DEBRID: 'Debrid connection required. Configure TorBox API key in module settings.',
  NO_TORBOX: 'TorBox connection required for this feature. Configure API key in module settings.',
  UNSUPPORTED_PROVIDER: (provider: string) =>
    `Provider "${provider}" not supported for this feature. TorBox required.`,
} as const;

export const AUDIO_EXTENSIONS = /\.(mp3|flac|wav|aac|ogg|wma|opus|ape|alac)$/i;

export const VIDEO_PATTERNS = [
  /\b(1080p|720p|2160p|480p|4k|uhd|bluray|bdrip|webrip|web-dl|webdl|hdtv|dvdrip|remux|x264|x265|hevc|h\.?264|h\.?265)\b/i,
  /\b(s\d{1,2}e\d{1,2}|season\s*\d+|episode\s*\d+|S\d{2})\b/i,
  /\b(movie|film|cinema|theatrical|directors\.cut|extended\.cut)\b/i,
  /\.(mkv|mp4|avi|mov|wmv|m4v)$/i,
];
