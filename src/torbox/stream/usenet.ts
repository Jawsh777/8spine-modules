/**
 * Usenet stream processing
 */

import type { ModuleContext, StreamResult } from '../../../types';
import { TORBOX_API_BASE, CONFIG, AUDIO_EXTENSIONS, ERRORS } from '../constants';
import type { TorBoxUsenet } from '../types';
import { wait } from '../utils';
import { getEffectiveDebridKey } from '../debrid';

export async function processUsenetDownload(
  nzbUrl: string,
  context: ModuleContext,
  trackId: string
): Promise<StreamResult> {
  console.log('[MusicTorrent] Adding NZB to TorBox usenet');

  const formData = new FormData();
  formData.append('link', nzbUrl);
  formData.append('seed', '1');
  formData.append('post_processing', '-1');

  const addReq = await fetch(TORBOX_API_BASE + '/usenet/createusenetdownload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + context.debridApiKey,
    },
    body: formData,
  });

  const addRespText = await addReq.text();
  let addResp: { success?: boolean; detail?: string; data?: { usenet_id: number } };

  try {
    addResp = JSON.parse(addRespText);
  } catch (e) {
    throw new Error('TorBox returned invalid JSON: ' + addRespText.substring(0, 100));
  }

  if (!addResp || !addResp.success) {
    if (addResp?.detail?.includes('already exists')) {
      console.log('[MusicTorrent] Usenet download exists, finding ID...');

      const listResp = (await fetch(TORBOX_API_BASE + '/usenet/mylist?bypass_cache=true', {
        headers: { Authorization: 'Bearer ' + context.debridApiKey },
      }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet[] };

      if (!listResp.success) {
        throw new Error('Failed to retrieve usenet list');
      }

      const list = Array.isArray(listResp.data) ? listResp.data : [];

      const hash = trackId.startsWith('nzb:') ? trackId.substring(4).split(':')[0] : trackId;

      const existing = list.find(
        (u) =>
          (u.hash && u.hash.toLowerCase() === hash.toLowerCase()) ||
          (u.name && u.name === nzbUrl.split('/').pop())
      );

      if (existing) {
        return await processUsenetItem(existing.id, context, trackId);
      } else {
        throw new Error('Usenet download reported as existing but not found in your library');
      }
    }

    throw new Error('TorBox usenet error: ' + (addResp.detail || 'Failed to add NZB'));
  }

  return await processUsenetItem(addResp.data!.usenet_id, context, trackId);
}

export async function processUsenetItem(
  usenetId: number,
  context: ModuleContext,
  trackId: string,
  trackIndex: number = 0
): Promise<StreamResult> {
  let fileId: number | null = null;
  let attempts = 0;

  while (attempts < CONFIG.TORRENT_POLL_ATTEMPTS) {
    await wait(CONFIG.POLL_INTERVAL);

    const info = (await fetch(TORBOX_API_BASE + '/usenet/mylist?id=' + usenetId, {
      headers: { Authorization: 'Bearer ' + context.debridApiKey },
    }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet | TorBoxUsenet[] };

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
            media.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            if (trackIndex < media.length) {
              fileId = media[trackIndex].id;
            } else {
              fileId = media[0].id;
            }
            break;
          }
        }
      }
    }

    attempts++;
  }

  if (!fileId) {
    throw new Error(
      'Usenet processing timed out or no audio files found. ' + 'Check your TorBox dashboard.'
    );
  }

  const url = `${TORBOX_API_BASE}/usenet/requestdl`;
  const params = new URLSearchParams({
    usenet_id: usenetId.toString(),
    file_id: fileId.toString(),
    zip_link: 'false',
  });

  const linkResp = (await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; detail?: string; data?: string };

  if (!linkResp.success) {
    throw new Error(linkResp.detail || 'Failed to get usenet download link');
  }

  return {
    streamUrl: linkResp.data!,
    track: {
      id: trackId,
      duration: 0,
    },
  };
}

export async function getUsenetFileStreamUrl(
  usenetId: string,
  fileId: string,
  context: ModuleContext
): Promise<string> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    throw new Error('No TorBox connection available');
  }

  try {
    const params = new URLSearchParams({
      token: debrid.apiKey,
      usenet_id: usenetId,
      file_id: fileId,
    });

    const url = `${TORBOX_API_BASE}/usenet/requestdl?${params}`;
    console.log('[MusicTorrent] Requesting usenet download URL with params:', {
      usenet_id: usenetId,
      file_id: fileId,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + debrid.apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        '[MusicTorrent] Initial request failed with status',
        response.status,
        ':',
        errorBody
      );

      const fallbackParams = new URLSearchParams({
        token: debrid.apiKey,
        usenet_id: usenetId,
        zip_link: 'true',
      });

      const fallbackUrl = `${TORBOX_API_BASE}/usenet/requestdl?${fallbackParams}`;
      const fallbackResp = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + debrid.apiKey,
        },
      });

      if (!fallbackResp.ok) {
        const fallbackError = await fallbackResp.text().catch(() => '');
        console.error(
          '[MusicTorrent] Fallback request failed with status',
          fallbackResp.status,
          ':',
          fallbackError
        );
        throw new Error(
          'HTTP ' +
            fallbackResp.status +
            ' - Fallback request (zip) failed to get usenet stream URL'
        );
      }

      const fallbackData = (await fallbackResp.json()) as { success?: boolean; data?: string };
      if (!fallbackData.success || !fallbackData.data) {
        throw new Error('Failed to get usenet stream URL from fallback request');
      }
      return fallbackData.data;
    }

    const data = (await response.json()) as { success?: boolean; detail?: string; data?: string };

    if (!data.success || !data.data) {
      throw new Error(data.detail || 'Failed to get usenet stream URL');
    }

    return data.data;
  } catch (e) {
    console.error('[MusicTorrent] Error getting usenet file stream URL:', e);
    throw e;
  }
}

export async function getUsenetStreamUrl(
  trackId: string,
  context: ModuleContext
): Promise<StreamResult> {
  const validPrefixes = ['nzb:', 'prowlarr-nzb:'];
  const hasValidPrefix = validPrefixes.some((prefix) => trackId.startsWith(prefix));

  if (!hasValidPrefix) {
    throw new Error('Invalid usenet track ID format - expected "nzb:" or "prowlarr-nzb:" prefix');
  }

  if (!context.debridApiKey) {
    throw new Error(ERRORS.NO_DEBRID);
  }

  if (context.debridProvider !== 'torbox') {
    throw new Error(ERRORS.UNSUPPORTED_PROVIDER(context.debridProvider || 'unknown'));
  }

  let hash: string;
  let trackIndex = 0;

  if (trackId.startsWith('prowlarr-nzb:')) {
    const afterPrefix = trackId.substring(13);
    const trackSuffixMatch = afterPrefix.match(/^(.+)-track-(\d+)$/);
    if (trackSuffixMatch) {
      hash = trackSuffixMatch[1];
      trackIndex = parseInt(trackSuffixMatch[2]);
    } else {
      hash = afterPrefix;
    }
  } else {
    hash = trackId.substring(4);
  }

  const listResp = (await fetch(TORBOX_API_BASE + '/usenet/mylist', {
    headers: { Authorization: 'Bearer ' + context.debridApiKey },
  }).then((r) => r.json())) as { success?: boolean; data?: TorBoxUsenet[] };

  if (!listResp.success) {
    throw new Error('Failed to get usenet download list');
  }

  const downloads = listResp.data || [];
  const usenetDownload = downloads.find(
    (d) =>
      (d.hash && d.hash.toLowerCase() === hash.toLowerCase()) ||
      (d.id && d.id.toString() === hash) ||
      (d.name && hash.length > 5 && d.name.toLowerCase().includes(hash.toLowerCase()))
  );

  if (!usenetDownload) {
    throw new Error('Usenet download not found in your library. Please add it to cloud first.');
  }

  return await processUsenetItem(usenetDownload.id, context, trackId, trackIndex);
}
