/**
 * Stream URL retrieval - main entry points
 */

import type { ModuleContext, StreamResult, QualityPreference } from '../../../types';
import { extractHash } from '../../utils';
import { TORBOX_API_BASE, ERRORS } from '../constants';
import { normalizeMagnetPrefix, getMagnetLink, mapProviderName } from '../utils';
import { getEffectiveDebridKey, resolveViaAPI } from '../debrid';
import { processTorBox } from './torbox';
import { processRealDebrid } from './realdebrid';
import { getUsenetStreamUrl, getUsenetFileStreamUrl } from './usenet';

export { processTorBox, processTorBoxTorrent } from './torbox';
export { processRealDebrid } from './realdebrid';
export {
  processUsenetDownload,
  processUsenetItem,
  getUsenetFileStreamUrl,
  getUsenetStreamUrl,
} from './usenet';

export async function getTrackStreamUrl(
  trackId: string,
  quality: QualityPreference,
  context: ModuleContext
): Promise<StreamResult> {
  if (trackId.startsWith('nzb:') || trackId.startsWith('prowlarr-nzb:')) {
    return await getUsenetStreamUrl(trackId, context);
  }

  let infoHash: string | null = null;
  let magnet: string | undefined = undefined;

  if (trackId.startsWith('tor:')) {
    infoHash = trackId.substring(4);
  } else if (trackId.startsWith('magnet:')) {
    magnet = normalizeMagnetPrefix(trackId);
    infoHash = extractHash(magnet);
  } else {
    infoHash = trackId;
  }

  if (!infoHash) {
    throw new Error('Could not extract info hash from track ID');
  }

  if (!context.debridApiKey) {
    throw new Error(ERRORS.NO_DEBRID);
  }

  const provider = mapProviderName(context.debridProvider || 'unknown');

  try {
    console.log('[MusicTorrent] Resolving via API debrid endpoint...');
    const resolveResult = await resolveViaAPI(infoHash, provider, context.debridApiKey);
    if (resolveResult) {
      return resolveResult;
    }
  } catch (e) {
    console.warn('[MusicTorrent] API resolve failed, using fallback:', (e as Error).message);
  }

  magnet = await getMagnetLink(infoHash, magnet);

  if (context.debridProvider === 'realdebrid') {
    return await processRealDebrid(magnet, context, trackId);
  } else if (context.debridProvider === 'torbox') {
    return await processTorBox(magnet, context, trackId);
  } else {
    throw new Error(
      `Direct processing not implemented for ${context.debridProvider}. ` + 'API resolution failed.'
    );
  }
}

export async function getStreamUrl(
  torrentId: string,
  fileId: string,
  context: ModuleContext
): Promise<string> {
  if (torrentId.startsWith('usenet:')) {
    return await getUsenetFileStreamUrl(torrentId.substring(7), fileId, context);
  }

  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const cleanId = torrentId.startsWith('torrent:') ? torrentId.substring(8) : torrentId;

    const params = new URLSearchParams({
      token: debrid.apiKey,
      torrent_id: cleanId,
      file_id: fileId,
    });

    const url = `${TORBOX_API_BASE}/torrents/requestdl?${params}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        '[MusicTorrent] Initial torrent request failed with status',
        response.status,
        ':',
        errorBody
      );

      const fallbackParams = new URLSearchParams({
        token: debrid.apiKey,
        torrent_id: cleanId,
        zip_link: 'true',
      });

      const fallbackUrl = `${TORBOX_API_BASE}/torrents/requestdl?${fallbackParams}`;
      const fallbackResp = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + debrid.apiKey,
        },
      });

      if (!fallbackResp.ok) {
        const fallbackError = await fallbackResp.text().catch(() => '');
        console.error(
          '[MusicTorrent] Fallback torrent request failed with status',
          fallbackResp.status,
          ':',
          fallbackError
        );
        throw new Error(
          'HTTP ' + fallbackResp.status + ' - Fallback request (zip) failed to get stream URL'
        );
      }

      const fallbackData = (await fallbackResp.json()) as { success?: boolean; data?: string };
      if (!fallbackData.success || !fallbackData.data) {
        throw new Error('Failed to get stream URL from fallback request');
      }
      return fallbackData.data;
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: string };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Failed to get stream URL');
    }

    return data.data;
  } catch (e) {
    console.error('[MusicTorrent] Error getting stream URL:', e);
    throw e;
  }
}
