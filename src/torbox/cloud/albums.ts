/**
 * Cloud albums management
 */

import type { ModuleContext } from '../../../types';
import { parseTorrentName } from '../../utils';
import { TORBOX_API_BASE, VIDEO_PATTERNS } from '../constants';
import type { CloudAlbum, TorBoxTorrent, TorBoxUsenet } from '../types';
import { getEffectiveDebridKey } from '../debrid';

export async function getCloudAlbums(
  context: ModuleContext
): Promise<{ albums: CloudAlbum[]; provider: string | null }> {
  const debrid = getEffectiveDebridKey(context);

  if (!debrid || debrid.provider !== 'torbox') {
    console.log('[MusicTorrent] No TorBox key available for cloud albums');
    return { albums: [], provider: null };
  }

  try {
    console.log('[MusicTorrent] Fetching TorBox cloud albums...');

    const [torrentResponse, usenetResponse] = await Promise.allSettled([
      fetch(TORBOX_API_BASE + '/torrents/mylist', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + debrid.apiKey },
      }),
      fetch(TORBOX_API_BASE + '/usenet/mylist', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + debrid.apiKey },
      }),
    ]);

    const albums: CloudAlbum[] = [];

    if (torrentResponse.status === 'fulfilled' && torrentResponse.value.ok) {
      const torrentData = (await torrentResponse.value.json()) as {
        success?: boolean;
        data?: TorBoxTorrent[];
      };
      if (torrentData.success) {
        const torrents = torrentData.data || [];
        const musicTorrents = torrents.filter((t) => {
          const name = (t.name || '').toLowerCase();
          for (const pattern of VIDEO_PATTERNS) {
            if (pattern.test(name)) return false;
          }
          return true;
        });

        const torrentAlbums: CloudAlbum[] = musicTorrents.map((t) => ({
          id: 'torrent:' + t.id,
          hash: t.hash,
          name: t.name,
          size: t.size,
          created_at: t.created_at,
          download_state: t.download_state,
          parsed: parseTorrentName(t.name),
          provider: 'torbox',
          source: 'module',
          type: 'torrent',
        }));

        albums.push(...torrentAlbums);
      }
    }

    if (usenetResponse.status === 'fulfilled' && usenetResponse.value.ok) {
      const usenetData = (await usenetResponse.value.json()) as {
        success?: boolean;
        data?: TorBoxUsenet[];
      };
      if (usenetData.success) {
        const usenetDownloads = usenetData.data || [];
        const musicUsenet = usenetDownloads.filter((u) => {
          const name = (u.name || '').toLowerCase();
          for (const pattern of VIDEO_PATTERNS) {
            if (pattern.test(name)) return false;
          }
          return true;
        });

        const usenetAlbums: CloudAlbum[] = musicUsenet.map((u) => ({
          id: 'usenet:' + u.id,
          hash: u.hash,
          name: u.name,
          size: u.size,
          created_at: u.created_at,
          download_state: u.download_state,
          parsed: parseTorrentName(u.name),
          provider: 'torbox',
          source: 'module',
          type: 'usenet',
        }));

        albums.push(...usenetAlbums);
      }
    }

    albums.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    console.log('[MusicTorrent] Found', albums.length, 'cloud albums (torrents + usenet)');
    return { albums, provider: 'torbox' };
  } catch (e) {
    console.error('[MusicTorrent] Error fetching cloud albums:', e);
    throw e;
  }
}
