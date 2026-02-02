/**
 * TorBox torrent stream processing
 */

import type { ModuleContext, StreamResult } from '../../../types';
import { extractHash } from '../../utils';
import { TORBOX_API_BASE, CONFIG, AUDIO_EXTENSIONS } from '../constants';
import type { TorBoxTorrent } from '../types';
import { wait } from '../utils';

export async function processTorBox(
  magnet: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding magnet to TorBox');

  const formData = new FormData();
  formData.append('magnet', magnet);
  formData.append('seed', '1');
  formData.append('allow_zip', 'false');

  const addReq = await fetch(TORBOX_API_BASE + '/torrents/createtorrent', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
    },
    body: formData,
  });

  const addRespText = await addReq.text();
  let addResp: { success?: boolean; detail?: string; data?: { torrent_id: number } };

  try {
    addResp = JSON.parse(addRespText);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + addRespText.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      console.log('[MusicTorrent] Torrent exists, finding ID...');

      const hash = extractHash(magnet);
      if (!hash) {
        throw new Error('Torrent exists but could not extract hash to locate it');
      }

      const listResp = (await fetch(TORBOX_API_BASE + '/torrents/mylist?bypass_cache=true', {
        headers: { Authorization: 'Bearer ' + context.debridApiKey },
      }).then((r) => r.json())) as { success?: boolean; data?: TorBoxTorrent[] };

      if (!listResp.success) {
        throw new Error('Failed to retrieve torrent list');
      }

      const list = Array.isArray(listResp.data) ? listResp.data : [];
      const existing = list.find((t) => t.hash && t.hash.toLowerCase() === hash.toLowerCase());

      if (existing) {
        return await processTorBoxTorrent(existing.id, context, trackId);
      } else {
        throw new Error('Torrent reported as existing but not found in your library');
      }
    }

    throw new Error('TorBox error: ' + (addResp.detail || 'Failed to add torrent'));
  }

  return await processTorBoxTorrent(addResp.data!.torrent_id, context, trackId);
}

export async function processTorBoxTorrent(
  torrentId: number,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  let fileId: number | null = null;
  let attempts = 0;

  while (attempts < CONFIG.TORRENT_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const info = (await fetch(TORBOX_API_BASE + '/torrents/mylist?id=' + torrentId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    }).then((r) => r.json())) as { success?: boolean; data?: TorBoxTorrent | TorBoxTorrent[] };

    if (info.success && info.data) {
      const dataArray = Array.isArray(info.data) ? info.data : [info.data];
      const data = dataArray[0];

      if (data) {
        const isReady =
          data.download_state === 'cached' ||
          data.download_state === 'completed' ||
          data.download_finished;

        if (isReady && data.files && data.files.length > 0) {
          const media = data.files.filter((f) => f.name && AUDIO_EXTENSIONS.test(f.name));

          if (media.length > 0) {
            media.sort((a, b) => (b.size || 0) - (a.size || 0));
            fileId = media[0].id;
            break;
          }
        }
      }
    }

    attempts++;
  }

  if (!fileId) {
    throw new Error(
      'Torrent processing timed out or no audio files found. ' + 'Check your TorBox dashboard.'
    );
  }

  const url = `${TORBOX_API_BASE}/torrents/requestdl`;
  const params = new URLSearchParams({
    torrent_id: torrentId.toString(),
    file_id: fileId.toString(),
    zip_link: 'false',
  });

  const linkResp = (await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; detail?: string; data?: string };

  if (!linkResp.success) {
    throw new Error(linkResp.detail || 'Failed to get download link');
  }

  return {
    streamUrl: linkResp.data!,
    track: {
      id: trackId,
      duration: 0,
    },
  };
}
