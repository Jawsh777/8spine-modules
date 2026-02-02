/**
 * Real-Debrid stream processing
 */

import type { ModuleContext, StreamResult } from '../../../types';
import { REALDEBRID_API_BASE, CONFIG } from '../constants';
import { wait } from '../utils';

export async function processRealDebrid(
  magnet: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding magnet to Real-Debrid');

  const addResp = await fetch(REALDEBRID_API_BASE + '/torrents/addMagnet', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'magnet=' + encodeURIComponent(magnet),
  });

  if (!addResp.ok) {
    const errorData = (await addResp.json().catch(() => ({}))) as { error?: string };
    throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to add magnet'));
  }

  const addData = (await addResp.json()) as { id: string };
  const torrentId = addData.id;
  console.log('[MusicTorrent] Real-Debrid torrent ID:', torrentId);

  const selectResp = await fetch(REALDEBRID_API_BASE + '/torrents/selectFiles/' + torrentId, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'files=all',
  });

  if (!selectResp.ok) {
    const errorData = (await selectResp.json().catch(() => ({}))) as { error?: string };
    throw new Error('Real-Debrid error: ' + (errorData.error || 'Failed to select files'));
  }

  let attempts = 0;

  while (attempts < CONFIG.REALDEBRID_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const infoResp = await fetch(REALDEBRID_API_BASE + '/torrents/info/' + torrentId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    });

    if (!infoResp.ok) {
      attempts++;
      continue;
    }

    const infoData = (await infoResp.json()) as { status: string; links?: string[] };
    console.log('[MusicTorrent] Real-Debrid status:', infoData.status);

    if (infoData.status === 'downloaded' && infoData.links?.length && infoData.links.length > 0) {
      const link = infoData.links[0];

      const unrestrictResp = await fetch(REALDEBRID_API_BASE + '/unrestrict/link', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + context.debridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'link=' + encodeURIComponent(link),
      });

      if (!unrestrictResp.ok) {
        throw new Error('Real-Debrid: Failed to unrestrict download link');
      }

      const unrestrictData = (await unrestrictResp.json()) as { download: string };
      return {
        streamUrl: unrestrictData.download,
        track: {
          id: trackId,
          duration: 0,
        },
      };
    }

    attempts++;
  }

  throw new Error('Torrent processing timed out. Check your Real-Debrid dashboard for status.');
}
