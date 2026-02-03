/**
 * 8spine Module Type Definitions
 * Provides TypeScript interfaces for creating type-safe 8spine modules.
 */

// ============================================================================
// TRACK & SEARCH TYPES
// ============================================================================

/**
 * A music track returned by search or used in streaming.
 */
export interface Track {
  /** Unique identifier for the track */
  id: string;
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Duration in seconds */
  duration: number;
  /** Track number in album */
  trackNumber?: number;
  /** Audio quality description (e.g., "24 bits / 96 kHz - Stereo") */
  audioQuality?: string;
  /** Release year */
  year?: number;
  /** File size in bytes */
  size?: number;
  /** Formatted file size (e.g., "45.2 MB") */
  sizeFormatted?: string;
  /** Album cover image URL */
  albumCover?: string;
  /** Artist identifier */
  artistId?: string;
  /** Album identifier */
  albumId?: string;

  // Torrent-specific fields
  /** Magnet URI */
  magnet?: string;
  /** BitTorrent info hash (40 hex chars for v1, 32 for v2) */
  infoHash?: string;
  /** Alias for infoHash */
  hash?: string;
  /** Number of seeders */
  seeders?: number;
  /** Number of leechers */
  leechers?: number;
  /** Whether the torrent is cached on debrid service */
  cached?: boolean;

  // Usenet-specific fields
  /** NZB download URL */
  nzb?: string;

  // Source tracking
  /** Content type: torrent or usenet */
  type?: 'torrent' | 'usenet';
  /** Source/indexer name */
  source?: string;
  /** Additional description */
  description?: string;
}

/**
 * Search results returned by searchTracks.
 */
export interface SearchResult {
  /** Array of matching tracks */
  tracks: Track[];
  /** Total number of results available */
  total: number;
  /** Source name (optional) */
  source?: string;
  /** Warning message (optional) */
  warning?: string;
}

// ============================================================================
// STREAM TYPES
// ============================================================================

/**
 * Result from getTrackStreamUrl.
 */
export interface StreamResult {
  /** Direct streaming URL */
  streamUrl: string;
  /** Track metadata for the stream */
  track: {
    /** Track identifier */
    id: string;
    /** Duration in seconds */
    duration?: number;
    /** Audio quality of the stream */
    audioQuality?: string;
    /** Bit depth (e.g., "24") */
    bitDepth?: string;
    /** Sample rate (e.g., "96") */
    sampleRate?: string;
  };
}

// ============================================================================
// ALBUM TYPES
// ============================================================================

/**
 * Album metadata.
 */
export interface Album {
  /** Album identifier */
  id: string;
  /** Album title */
  title: string;
  /** Artist name */
  artist: string;
  /** Artist identifier */
  artistId?: string;
  /** Cover image URL */
  cover?: string;
  /** Release year */
  year?: number;
  /** Number of tracks */
  trackCount?: number;
  /** Total duration in seconds */
  duration?: number;
  /** Audio quality description */
  audioQuality?: string;
  /** Album description */
  description?: string;
}

/**
 * Album with full track listing.
 */
export interface AlbumDetails extends Album {
  /** Tracks in the album */
  tracks: Track[];
}

// ============================================================================
// CLOUD / DEBRID TYPES
// ============================================================================

/**
 * Supported debrid provider names.
 */
export type DebridProvider = 'torbox' | 'realdebrid' | 'premiumize' | 'alldebrid';

/**
 * Cloud album/download from a debrid provider.
 */
export interface CloudAlbum {
  /** Download identifier */
  id: string;
  /** Torrent info hash (if applicable) */
  hash?: string;
  /** Download name/title */
  name: string;
  /** Size in bytes */
  size?: number;
  /** Creation timestamp */
  created_at?: string;
  /** Download state (e.g., "downloading", "completed") */
  download_state?: string;
  /** Parsed metadata from the name */
  parsed?: {
    artist: string | null;
    album: string | null;
    quality: string | null;
  };
  /** Provider name */
  provider: string;
  /** Source type */
  source: string;
  /** Content type */
  type: 'torrent' | 'usenet';
}

/**
 * Result from addToCloud.
 */
export interface AddToCloudResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Status message */
  message: string;
}

/**
 * Result from getCloudAlbums.
 */
export interface CloudAlbumsResult {
  /** List of cloud albums */
  albums: CloudAlbum[];
  /** Provider name (null if not connected) */
  provider: string | null;
}

/**
 * API key verification result.
 */
export interface VerifyKeyResult {
  /** Whether the key is valid */
  success: boolean;
  /** Error message if verification failed */
  error?: string;
  /** Account username/email */
  accountName?: string;
  /** Subscription plan */
  plan?: string;
  /** Account expiry date */
  expiry?: string;
}

/**
 * File within a torrent/download.
 */
export interface TorrentFile {
  /** File identifier */
  id: string | number;
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** File path within the torrent */
  path?: string;
}

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Runtime value of a setting.
 */
export interface SettingValue {
  /** The user-provided value */
  value: string;
}

/**
 * Context object passed to module functions at runtime.
 */
export interface ModuleContext {
  /** Global debrid API key (from app settings) */
  debridApiKey?: string;
  /** Global debrid provider name */
  debridProvider?: DebridProvider;
  /** Module-specific settings with their runtime values */
  settings?: Record<string, SettingValue | string>;
}

/**
 * Quality preference for streaming.
 */
export type QualityPreference =
  | 'MAX'
  | 'LOSSLESS'
  | 'HI_RES_LOSSLESS'
  | 'HIGH'
  | 'LOW'
  | number
  | string;

// ============================================================================
// SETTINGS TYPES
// ============================================================================

/**
 * Option for selector settings.
 */
export interface SelectorOption {
  /** Display label */
  label: string;
  /** Value when selected */
  value: string;
}

/**
 * Base properties for all setting types.
 */
interface BaseSetting {
  /** User-facing label */
  label: string;
  /** Help text description */
  description?: string;
  /** Default value */
  defaultValue?: string;
}

/**
 * Text input setting.
 */
export interface TextSetting extends BaseSetting {
  type: 'text';
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Dropdown/selector setting.
 */
export interface SelectorSetting extends BaseSetting {
  type: 'selector';
  /** Available options */
  options: SelectorOption[];
}

/**
 * Debrid API key setting with verification.
 */
export interface DebridSetting extends BaseSetting {
  type: 'debrid';
  /** Debrid provider identifier */
  provider: DebridProvider;
  /** Display name of the provider */
  providerName: string;
  /** Provider logo URL */
  providerLogo?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Name of the verification function in the module */
  verifyAction: string;
}

/**
 * Toggle/boolean setting.
 */
export interface ToggleSetting extends BaseSetting {
  type: 'toggle';
  /** Default toggle state */
  defaultValue?: boolean;
}

/**
 * All setting types.
 */
export type ModuleSetting = TextSetting | SelectorSetting | DebridSetting | ToggleSetting;

/**
 * Settings schema object.
 */
export type SettingsSchema = Record<string, ModuleSetting>;

// ============================================================================
// MODULE INTERFACE
// ============================================================================

/**
 * Module labels for categorization.
 */
export type ModuleLabel =
  | 'GLOBAL'
  | 'TORRENT'
  | 'USENET'
  | 'STREAMING'
  | 'MUSIC'
  | 'LOSSLESS'
  | 'PROWLARR'
  | 'Hi-Fi'
  | string;

/**
 * UI mode for the module.
 */
export type UIMode = 'standard' | 'torrent' | 'minimal';

/**
 * Complete 8spine module interface.
 *
 * This is the return type that all modules must conform to.
 */
export interface Module8Spine {
  // -------------------------------------------------------------------------
  // Required Metadata
  // -------------------------------------------------------------------------

  /** Unique module identifier (lowercase, hyphens allowed) */
  id: string;
  /** Display name */
  name: string;
  /** Semantic version (e.g., "1.0.0") */
  version: string;
  /** Module author */
  author: string;
  /** Module description */
  description: string;
  /** Tags/labels for categorization */
  labels: ModuleLabel[];

  // -------------------------------------------------------------------------
  // Optional Metadata
  // -------------------------------------------------------------------------

  /** Logo image URL */
  logo?: string;
  /** UI mode */
  uiMode?: UIMode;
  /** Supported debrid providers */
  supportedDebridProviders?: DebridProvider[];
  /** Whether module provides cloud albums */
  providesCloudAlbums?: boolean;
  /** Whether to auto-stream first result */
  automaticStreaming?: boolean;

  // -------------------------------------------------------------------------
  // Required Functions
  // -------------------------------------------------------------------------

  /**
   * Search for tracks.
   * @param query - Search query string
   * @param limit - Maximum number of results
   * @param context - Runtime context with settings
   * @returns Search results with tracks array and total count
   */
  searchTracks: (
    query: string,
    limit: number,
    context: ModuleContext
  ) => Promise<SearchResult>;

  /**
   * Get a streamable URL for a track.
   * @param trackId - Track identifier
   * @param quality - Preferred quality
   * @param context - Runtime context with settings
   * @returns Stream URL and track metadata
   */
  getTrackStreamUrl: (
    trackId: string,
    quality: QualityPreference,
    context: ModuleContext
  ) => Promise<StreamResult>;

  // -------------------------------------------------------------------------
  // Optional Functions
  // -------------------------------------------------------------------------

  /**
   * Get album details with track listing.
   * @param albumId - Album identifier
   * @param context - Runtime context (optional)
   * @returns Album details with tracks
   */
  getAlbum?: (albumId: string, context?: ModuleContext) => Promise<AlbumDetails>;

  /**
   * Add a track/torrent to cloud storage.
   * @param track - Track to add (must have magnet or nzb)
   * @param context - Runtime context with debrid settings
   * @returns Success status and message
   */
  addToCloud?: (track: Track, context: ModuleContext) => Promise<AddToCloudResult>;

  /**
   * Check which hashes are cached on the debrid service.
   * @param hashes - Array of info hashes to check
   * @param context - Runtime context with debrid settings
   * @returns Object mapping hash to cached status
   */
  checkCached?: (
    hashes: string[],
    context: ModuleContext
  ) => Promise<Record<string, boolean>>;

  /**
   * Get user's cloud library.
   * @param context - Runtime context with debrid settings
   * @returns Cloud albums and provider name
   */
  getCloudAlbums?: (context: ModuleContext) => Promise<CloudAlbumsResult>;

  /**
   * List files in a torrent/download.
   * @param torrentId - Torrent/download identifier
   * @param context - Runtime context with debrid settings
   * @returns Array of files
   */
  getTorrentFiles?: (
    torrentId: string,
    context: ModuleContext
  ) => Promise<TorrentFile[]>;

  /**
   * Get stream URL for a specific file in a torrent.
   * @param torrentId - Torrent/download identifier
   * @param fileId - File identifier within the torrent
   * @param context - Runtime context with debrid settings
   * @returns Direct stream URL
   */
  getStreamUrl?: (
    torrentId: string,
    fileId: string,
    context: ModuleContext
  ) => Promise<string>;

  // -------------------------------------------------------------------------
  // Verification Functions
  // -------------------------------------------------------------------------

  /**
   * Verify a TorBox API key.
   * Referenced by settings with verifyAction: 'verifyTorBoxKey'
   */
  verifyTorBoxKey?: (apiKey: string) => Promise<VerifyKeyResult>;

  /**
   * Generic verification function pattern.
   * Modules can define custom verify functions referenced in settings.
   */
  [key: `verify${string}`]: ((apiKey: string) => Promise<VerifyKeyResult>) | undefined;

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /** Module settings schema */
  settings?: SettingsSchema;
}

// ============================================================================
// BUILD METADATA
// ============================================================================

/**
 * Build-time metadata for module-source.json generation.
 * This metadata is extracted at build time and not used at runtime.
 */
export interface ModuleBuildMeta {
  /** Module type */
  type: 'MODULE' | 'LIBRARY';
  /** Category for grouping in module-source.json */
  category: string;
  /** Export name for the .8spine file (e.g., 'QOBUZ_MODULE_CODE') */
  exportName: string;
  /** Whether this module is featured */
  featured: boolean;
  /** Whether this module is from a trusted source */
  trusted: boolean;
  /** Whether this module contains NSFW content */
  nsfw: boolean;
}

/**
 * Complete module interface including build metadata.
 * Use this with `satisfies` for full type safety:
 *
 * @example
 * const module = {
 *   id: 'my-module',
 *   name: 'My Module',
 *   // ... all properties ...
 *   __meta: {
 *     type: 'MODULE',
 *     category: 'modules',
 *     exportName: 'MY_MODULE_CODE',
 *     featured: false,
 *     trusted: true,
 *     nsfw: false,
 *   },
 * } as const satisfies Module8SpineFull;
 */
export interface Module8SpineFull extends Module8Spine {
  /** Build-time metadata for module-source.json generation */
  __meta: ModuleBuildMeta;
}

// ============================================================================
// HELPER FUNCTION
// ============================================================================

/**
 * Helper to define a module with type checking.
 *
 * @example
 * const module = defineModule({
 *   id: 'my-module',
 *   name: 'My Module',
 *   // ... full type checking
 * });
 *
 * export default module;
 */
export function defineModule(module: Module8Spine): Module8Spine {
  return module;
}
