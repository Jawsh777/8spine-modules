/**
 * Type definitions for the TorBox module
 */

import type { Track, SearchResult } from '../../types';
import type { ParsedTorrentName } from '../utils';

export interface DebridKey {
  apiKey: string;
  provider: string;
  source: string;
}

export interface ProwlarrConfig {
  baseUrl: string;
  apiKey: string;
}

export interface TorrentTrack extends Track {
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
  type?: 'torrent' | 'usenet';
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

export interface TorrentSearchResult extends SearchResult {
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

export interface CloudAlbum {
  id: string;
  hash?: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  parsed: ParsedTorrentName;
  provider: string;
  source: string;
  type: 'torrent' | 'usenet';
}

export interface TorBoxFile {
  id: number;
  name: string;
  short_name?: string;
  size: number;
}

export interface TorBoxTorrent {
  id: number;
  hash: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  download_finished?: boolean;
  files?: TorBoxFile[];
}

export interface TorBoxUsenet {
  id: number;
  hash: string;
  name: string;
  size: number;
  created_at: string;
  download_state: string;
  download_finished?: boolean;
  files?: TorBoxFile[];
}

export interface VerifyResult {
  success: boolean;
  error?: string;
  accountName?: string;
  plan?: string;
  expiry?: string;
}

export interface AudioFile {
  id: number;
  name: string;
  short_name: string;
  size: number;
}
