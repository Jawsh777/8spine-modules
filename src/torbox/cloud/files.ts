/**
 * Cloud file management
 */

import type { ModuleContext } from '../../../types';
import { getFromCache, setCache } from '../../utils';
import { TORBOX_API_BASE, AUDIO_EXTENSIONS } from '../constants';
import type { TorBoxTorrent, TorBoxUsenet, AudioFile } from '../types';
import { getEffectiveDebridKey } from '../debrid';

export async function getTorrentFiles(
  torrentId: string,
  context: ModuleContext
): Promise<AudioFile[]> {
  if (torrentId.startsWith('usenet:')) {
    return await getUsenetFiles(torrentId.substring(7), context);
  }

  const cleanId = torrentId.startsWith('torrent:') ? torrentId.substring(8) : torrentId;
  const cacheKey = `files:${cleanId}`;
  const cached = getFromCache<AudioFile[]>(cacheKey);

  if (cached) {
    console.log('[MusicTorrent] Using cached files for', cacheKey);
    return cached;
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const response = await fetch(TORBOX_API_BASE + '/torrents/mylist?id=' + cleanId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch torrent info: HTTP ' + response.status);
    }

    const data = (await response.json()) as {
      success?: boolean;
      detail?: string;
      data?: TorBoxTorrent;
    };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Torrent not found');
    }

    const torrent = data.data;
    const files = torrent.files || [];

    const audioFiles = files
      .filter((f) => AUDIO_EXTENSIONS.test(f.name || f.short_name || ''))
      .map((f) => ({
        id: f.id,
        name: f.name || f.short_name || '',
        short_name: f.short_name || f.name || '',
        size: f.size,
      }));

    console.log('[MusicTorrent] Found', audioFiles.length, 'audio files in torrent');
    setCache(cacheKey, audioFiles);
    return audioFiles;
  } catch (e) {
    console.error('[MusicTorrent] Error fetching torrent files:', e);
    throw e;
  }
}

export async function getUsenetFiles(
  usenetId: string,
  context: ModuleContext
): Promise<AudioFile[]> {
  const cacheKey = `usenet-files:${usenetId}`;
  const cached = getFromCache<AudioFile[]>(cacheKey);

  if (cached) {
    console.log('[MusicTorrent] Using cached usenet files for', cacheKey);
    return cached;
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const response = await fetch(TORBOX_API_BASE + '/usenet/mylist?id=' + usenetId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch usenet info: HTTP ' + response.status);
    }

    const data = (await response.json()) as {
      success?: boolean;
      detail?: string;
      data?: TorBoxUsenet;
    };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Usenet download not found');
    }

    const usenetDownload = data.data;
    const files = usenetDownload.files || [];

    const audioFiles = files
      .filter((f) => AUDIO_EXTENSIONS.test(f.name || f.short_name || ''))
      .map((f) => ({
        id: f.id,
        name: f.name || f.short_name || '',
        short_name: f.short_name || f.name || '',
        size: f.size,
      }));

    console.log('[MusicTorrent] Found', audioFiles.length, 'audio files in usenet download');
    setCache(cacheKey, audioFiles);
    return audioFiles;
  } catch (e) {
    console.error('[MusicTorrent] Error fetching usenet files:', e);
    throw e;
  }
}
