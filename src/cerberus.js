// @8spine-export CERBERUS_MODULE_CODE
/* @8spine-meta
 * author: jawsh
 * type: MODULE
 * category: modules
 * featured: false
 * trusted: true
 * nsfw: false
 */
/**
 * Cerberus Module
 * Three-headed guardian of Tidal streams - races 3 random endpoints for fastest, most reliable access
 */

// Logging
const LOG_PREFIX = '[Cerberus]';

// Default values for missing data
const DEFAULTS = {
    ARTIST: 'Unknown Artist',
    ALBUM: 'Unknown Album',
    QUALITY: 'Unknown Quality'
};

// Tidal cover image configuration
const TIDAL_COVER = {
    BASE_URL: 'https://resources.tidal.com/images/',
    SIZE: '640x640.jpg'
};

// HTTP request configuration
const HTTP_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': '8spine/1.0'
};

const ENDPOINTS = [
    'https://tidal.squid.wtf',
    'https://triton.squid.wtf',
    'https://tidal.kinoplus.online',
    'https://wolf.qqdl.site',
    'https://maus.qqdl.site',
    'https://vogel.qqdl.site',
    'https://katze.qqdl.site',
    'https://hund.qqdl.site',
    'https://tidal-api.binimum.org',
    'https://aether.squid.wtf',
    'https://zeus.squid.wtf',
    'https://kraken.squid.wtf',
    'https://phoenix.squid.wtf',
    'https://shiva.squid.wtf',
    'https://chaos.squid.wtf',
    'https://hifi-one.spotisaver.net',
    'https://hifi-two.spotisaver.net',
    'https://monochrome.samidy.com',
    'https://monochrome-api.samidy.com',
    'https://music.binimum.org',
    'https://tidal.qqdl.site',
    'https://music.arjix.dev',
    'https://spo.free.nf'
];

const RACE_SIZE = 3;  // Number of endpoints to race simultaneously

const QUALITY = {
    LOW: 'LOW',
    HIGH: 'HIGH',
    LOSSLESS: 'LOSSLESS',
    HI_RES_LOSSLESS: 'HI_RES_LOSSLESS'
};

const QUALITY_OPTIONS = [
    { label: 'Data Saver', value: QUALITY.LOW },
    { label: 'High Quality', value: QUALITY.HIGH },
    { label: 'Lossless', value: QUALITY.LOSSLESS },
    { label: 'Hi-Res Lossless', value: QUALITY.HI_RES_LOSSLESS }
];

const FALLBACK_MODE = {
    FLEXIBLE: 'flexible',
    STRICT: 'strict'
};

const FALLBACK_MODE_OPTIONS = [
    { label: 'Flexible', value: FALLBACK_MODE.FLEXIBLE },
    { label: 'Strict', value: FALLBACK_MODE.STRICT }
];

// Fallback chains for each quality level
const QUALITY_FALLBACKS = {
    [QUALITY.LOW]: [QUALITY.HIGH, QUALITY.LOSSLESS, QUALITY.HI_RES_LOSSLESS],
    [QUALITY.HIGH]: [QUALITY.LOSSLESS, QUALITY.HI_RES_LOSSLESS, QUALITY.LOW],
    [QUALITY.LOSSLESS]: [QUALITY.HIGH, QUALITY.HI_RES_LOSSLESS, QUALITY.LOW],
    [QUALITY.HI_RES_LOSSLESS]: [QUALITY.LOSSLESS, QUALITY.HIGH, QUALITY.LOW]
};

function pickRandomEndpoints(endpoints, count) {
    const shuffled = [...endpoints].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

async function fetchWithRace(endpoint) {
    const tried = new Set();

    while (tried.size < ENDPOINTS.length) {
        // Get endpoints we haven't tried yet
        const available = ENDPOINTS.filter(e => !tried.has(e));
        const batchSize = Math.min(RACE_SIZE, available.length);

        if (batchSize === 0) break;

        // Pick random endpoints from available pool
        const batch = pickRandomEndpoints(available, batchSize);
        batch.forEach(e => tried.add(e));

        console.log(LOG_PREFIX, 'Racing endpoints:', batch.map(u => new URL(u).hostname).join(', '));

        // Race the batch using Promise.any
        try {
            const result = await Promise.any(
                batch.map(baseUrl =>
                    fetch(baseUrl + endpoint, {
                        headers: HTTP_HEADERS
                    }).then(response => {
                        if (!response.ok) {
                            throw new Error('HTTP ' + response.status);
                        }
                        return response.json();
                    })
                )
            );
            return result;
        } catch (e) {
            console.warn(LOG_PREFIX, 'Batch failed, trying next batch...');
        }
    }

    throw new Error('All endpoints failed');
}

function extractStreamUrl(manifest) {
    if (!manifest) return null;
    try {
        // Manifest is base64 encoded
        const decoded = atob(manifest);
        const parsed = JSON.parse(decoded);

        if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
            return parsed.urls[0];
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'Failed to decode manifest:', error);
    }
    return null;
}

function getTidalCoverUrl(uuid) {
    if (!uuid || typeof uuid !== 'string') return null;
    if (uuid.startsWith('http')) return uuid;
    // Check if it looks like a GUID/UUID
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        return uuid;
    }
    const path = uuid.replace(/-/g, '/');
    return TIDAL_COVER.BASE_URL + path + '/' + TIDAL_COVER.SIZE;
}

async function searchTracks(query, limit = 25) {
    try {
        const data = await fetchWithRace('/search/?s=' + encodeURIComponent(query) + '&limit=' + limit);

        // Response format: {"version":"2.0", "data":{ "items": [...] }}
        const items = data.data?.items || [];

        return {
            tracks: items.map(track => ({
                id: track.id,
                title: track.title,
                artist: track.artist?.name || track.artists?.[0]?.name || DEFAULTS.ARTIST,
                artistId: track.artist?.id || track.artists?.[0]?.id,
                album: track.album?.title || DEFAULTS.ALBUM,
                albumId: track.album?.id,
                albumCover: getTidalCoverUrl(track.album?.cover),
                duration: track.duration || 0,
                trackNumber: track.trackNumber,
                audioQuality: track.audioQuality || DEFAULTS.QUALITY,
            })),
            total: data.data?.totalNumberOfItems || items.length,
        };
    } catch (error) {
        console.error(LOG_PREFIX, 'Search failed:', error);
        throw error;
    }
}

async function fetchStreamWithQuality(trackId, quality) {
    const data = await fetchWithRace('/track/?id=' + trackId + '&quality=' + quality);

    // Response format: {"version":"2.0", "data":{ "trackId":..., "manifest": "..." }}
    const trackData = data.data;

    if (!trackData || !trackData.manifest) {
        throw new Error('No manifest found in response');
    }

    const streamUrl = extractStreamUrl(trackData.manifest);
    if (!streamUrl) {
        throw new Error('Failed to extract stream URL from manifest');
    }

    return {
        streamUrl,
        track: {
            id: trackData.trackId || trackId,
            audioQuality: trackData.audioQuality,
            bitDepth: trackData.bitDepth,
            sampleRate: trackData.sampleRate,
        }
    };
}

async function getTrackStreamUrl(trackId, preferredQuality, context) {
    const quality = context?.settings?.quality?.value || QUALITY.LOSSLESS;
    const fallbackMode = context?.settings?.fallbackMode?.value || FALLBACK_MODE.FLEXIBLE;

    // Build quality list based on fallback mode
    const qualitiesToTry = fallbackMode === FALLBACK_MODE.STRICT
        ? [quality]
        : [quality, ...(QUALITY_FALLBACKS[quality] || [])];

    let lastError;
    for (const q of qualitiesToTry) {
        try {
            const result = await fetchStreamWithQuality(trackId, q);
            if (q !== quality) {
                console.warn(LOG_PREFIX, quality + ' unavailable, using ' + q);
            }
            return result;
        } catch (e) {
            const hasMoreQualities = qualitiesToTry.indexOf(q) < qualitiesToTry.length - 1;
            console.warn(LOG_PREFIX, q + ' failed' + (hasMoreQualities ? ', trying next...' : ''));
            lastError = e;
        }
    }

    throw lastError || new Error('All quality levels failed');
}

async function getAlbum(albumId) {
    try {
        throw new Error('Album fetch not fully implemented for Cerberus');
        //const data = await fetchWithRace('/album/?id=' + albumId);
    } catch (e) {
        throw e;
    }
}

return {
    id: 'cerberus',
    name: 'Cerberus',
    author: 'Jawsh',
    version: '1.0.0',
    labels: ['Tidal', 'High Quality', 'Multi-Endpoint', 'Reliable'],
    description: 'Three-headed guardian of Tidal streams. Races 3 random endpoints for fastest, most reliable access.',

    settings: {
        quality: {
            type: 'selector',
            label: 'Audio Quality',
            description: 'Select preferred streaming quality for tracks',
            options: QUALITY_OPTIONS,
            defaultValue: QUALITY.LOSSLESS
        },
        fallbackMode: {
            type: 'selector',
            label: 'Quality Fallback',
            description: 'What to do when preferred quality is unavailable',
            options: FALLBACK_MODE_OPTIONS,
            defaultValue: FALLBACK_MODE.FLEXIBLE
        }
    },

    searchTracks,
    getTrackStreamUrl,
    getAlbum
};
