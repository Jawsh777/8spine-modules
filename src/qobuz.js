// @8spine-export QOBUZ_MODULE_CODE
/* @8spine-meta
 * author: jawsh
 * type: MODULE
 * category: modules
 * featured: false
 * trusted: true
 * nsfw: false
 */
/**
 * Qobuz Module (via Squid.wtf)
 * High-quality music streaming from Qobuz API
 */

const BASE_URL = 'https://qobuz.squid.wtf/api';

async function fetchJson(endpoint) {
    const url = BASE_URL + endpoint;
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Qobuz8Spine/1.0',
        }
    });

    if (!response.ok) {
        throw new Error('[Qobuz] HTTP ' + response.status);
    }

    return await response.json();
}

function buildTrackTitle(track) {
    if (!track) return 'Unknown Track';
    let title = track.title || 'Unknown Track';
    if (track.version) {
        title += ' (' + track.version + ')';
    }
    return title;
}

function buildAlbumTitle(album) {
    if (!album) return 'Unknown Album';
    let title = album.title || 'Unknown Album';
    if (album.version) {
        title += ' (' + album.version + ')';
    }
    return title;
}

function determineAudioQuality(track) {
    if (!track) return 'Unknown';

    // Use maximum_technical_specifications if available
    if (track.maximum_technical_specifications) {
        return track.maximum_technical_specifications;
    }

    // Build quality string from individual fields
    const bitDepth = track.maximum_bit_depth || '?';
    const sampleRate = track.maximum_sampling_rate || '?';
    const channels = track.maximum_channel_count === 2 ? 'Stereo' : 'Unknown';

    return bitDepth + ' bits / ' + sampleRate + ' kHz - ' + channels;
}

async function searchTracks(query, limit = 50, context) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const data = await fetchJson('/get-music?q=' + encodedQuery + '&offset=0');

        // Check for successful response
        if (!data.success || !data.data) {
            console.error('[Qobuz] Invalid response structure');
            return { tracks: [], total: 0 };
        }

        // Extract tracks from nested structure
        const tracksData = data.data.tracks || {};
        const items = tracksData.items || [];

        // Transform to standard track format
        const tracks = items.map(track => {
            return {
                id: String(track.id),
                title: buildTrackTitle(track),
                artist: track.performer?.name || 'Unknown Artist',
                artistId: track.performer?.id ? String(track.performer.id) : undefined,
                album: buildAlbumTitle(track.album),
                albumId: track.album?.qobuz_id ? String(track.album.qobuz_id) : undefined,
                albumCover: track.album?.image?.large || track.album?.image?.small,
                duration: track.duration || 0,
                trackNumber: track.track_number,
                audioQuality: determineAudioQuality(track),
            };
        });

        return {
            tracks: tracks,
            total: tracksData.total || items.length,
        };
    } catch (error) {
        console.error('[Qobuz] Search failed:', error);
        throw error;
    }
}

async function getTrackStreamUrl(trackId, preferredQuality, context) {
    try {
        // Get quality from context settings
        let quality = context.settings.quality.value;
        // Default to Studio Master quality
        if (!quality) {
            quality = '27';
        }

        // Fetch the JSON response containing the stream URL
        const data = await fetchJson('/download-music?track_id=' + trackId + '&quality=' + quality);

        // Check for successful response
        if (!data.success || !data.data) {
            throw new Error('[Qobuz] Failed to get stream URL');
        }

        // Extract the actual streaming URL from the nested data
        const streamUrl = data.data.url;

        if (!streamUrl) {
            throw new Error('[Qobuz] No stream URL found in response');
        }

        return {
            streamUrl: streamUrl,
            track: {
                id: trackId,
                audioQuality: 'Quality ' + quality,
            }
        };

    } catch (error) {
        console.error('[Qobuz] Get stream failed:', error);
        throw error;
    }
}

async function getAlbum(albumId) {
    // Album browsing not implemented for this API
    throw new Error('[Qobuz] Album browsing not available for this module');
}

return {
    id: 'qobuz',
    name: 'Qobuz (Squid.wtf)',
    author: 'Jawsh',
    version: '1.0.0',
    labels: ['Hi-Fi', 'Qobuz', 'Lossless'],
    description: 'High-quality music streaming from Qobuz via squid.wtf API',

    settings: {
        quality: {
            type: 'selector',
            label: 'Audio Quality',
            description: 'Select preferred streaming quality',
            options: [
                { label: 'Lossy', value: '5' },
                { label: 'Lossless', value: '27' }
            ],
            defaultValue: '27'
        }
    },

    searchTracks: searchTracks,
    getTrackStreamUrl: getTrackStreamUrl,
    getAlbum: getAlbum
};
