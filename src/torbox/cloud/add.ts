/**
 * Add to cloud functionality
 */

import type { ModuleContext } from '../../../types';
import { extractHash } from '../../utils';
import { TORBOX_API_BASE, REALDEBRID_API_BASE, ERRORS } from '../constants';
import type { TorrentTrack } from '../types';
import { normalizeMagnetPrefix, getMagnetLink } from '../utils';
import { getEffectiveDebridKey } from '../debrid';

export async function addToCloud(
  track: TorrentTrack,
  context: ModuleContext
): Promise<{ success: boolean; message: string }> {
  if (
    track.id.startsWith('nzb:') ||
    track.id.startsWith('prowlarr-nzb:') ||
    track.type === 'usenet'
  ) {
    return await addUsenetToCloud(track, context);
  }

  let infoHash: string | null = null;
  let magnet: string | undefined = undefined;

  if (track.infoHash) {
    infoHash = track.infoHash;
  } else if (track.id.startsWith('tor:')) {
    infoHash = track.id.substring(4);
  } else if (track.id.startsWith('magnet:')) {
    magnet = normalizeMagnetPrefix(track.id);
    infoHash = extractHash(magnet);
  }

  if (track.magnet && !magnet) {
    magnet = track.magnet;
  }

  if (!magnet) {
    magnet = await getMagnetLink(infoHash || '', magnet);
  }

  if (!magnet) {
    throw new Error('Could not determine magnet link for torrent');
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid) {
    throw new Error(ERRORS.NO_TORBOX);
  }

  const { apiKey, provider, source } = debrid;
  console.log('[MusicTorrent] Using debrid from:', source, '- Provider:', provider);

  if (provider === 'torbox') {
    console.log('[MusicTorrent] Adding magnet to TorBox');

    const formData = new FormData();
    formData.append('magnet', magnet);
    formData.append('seed', '1');
    formData.append('allow_zip', 'false');

    const addReq = await fetch(TORBOX_API_BASE + '/torrents/createtorrent', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
      },
      body: formData,
    });

    const text = await addReq.text();
    let addResp: { success?: boolean; detail?: string };

    try {
      addResp = JSON.parse(text);
    } catch (e) {
      throw new Error('TorBox returned invalid JSON: ' + text.substring(0, 100));
    }

    if (!addResp || !addResp.success) {
      if (addResp?.detail?.includes('already exists')) {
        return { success: true, message: 'Torrent already exists in TorBox' };
      }
      throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add torrent'));
    }

    return { success: true, message: 'Torrent added to TorBox successfully' };
  } else if (provider === 'realdebrid') {
    console.log('[MusicTorrent] Adding magnet to Real-Debrid');

    const addResp = await fetch(REALDEBRID_API_BASE + '/torrents/addMagnet', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'magnet=' + encodeURIComponent(magnet),
    });

    if (!addResp.ok) {
      const errorData = (await addResp.json().catch(() => ({}))) as { error?: string };
      throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to add magnet'));
    }

    const addData = (await addResp.json()) as { id: string };

    const selectResp = await fetch(REALDEBRID_API_BASE + '/torrents/selectFiles/' + addData.id, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'files=all',
    });

    if (!selectResp.ok) {
      const errorData = (await selectResp.json().catch(() => ({}))) as { error?: string };
      throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to select files'));
    }

    return { success: true, message: 'Torrent added to Real-Debrid successfully' };
  } else {
    throw new Error('Unsupported debrid provider: ' + provider);
  }
}

export async function addUsenetToCloud(
  track: TorrentTrack,
  context: ModuleContext
): Promise<{ success: boolean; message: string }> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid) {
    throw new Error(ERRORS.NO_TORBOX);
  }

  if (debrid.provider !== 'torbox') {
    throw new Error(ERRORS.UNSUPPORTED_PROVIDER(debrid.provider));
  }

  const { apiKey, provider, source } = debrid;
  console.log('[MusicTorrent] Using debrid from:', source, '- Provider:', provider);

  if (!track.nzb) {
    throw new Error('No NZB URL available for this track');
  }

  console.log('[MusicTorrent] Adding NZB to TorBox');

  const formData = new FormData();
  formData.append('link', track.nzb);
  formData.append('seed', '1');
  formData.append('post_processing', '-1');

  const addReq = await fetch(TORBOX_API_BASE + '/usenet/createusenetdownload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
    },
    body: formData,
  });

  const text = await addReq.text();
  let addResp: { success?: boolean; detail?: string };

  try {
    addResp = JSON.parse(text);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + text.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      return { success: true, message: 'Usenet download already exists in TorBox' };
    }
    throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add NZB'));
  }

  return { success: true, message: 'Usenet download added to TorBox successfully' };
}
