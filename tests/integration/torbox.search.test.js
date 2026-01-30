const { loadSourceModule, getModulePaths } = require('../helpers/moduleLoader');
const { setupFetchMock, torboxSuccess, torboxError } = require('../helpers/mockFetch');
const fixtures = require('../fixtures/searchResults.json');

describe('Torbox Module - Search Integration', () => {
    let module;
    const paths = getModulePaths();

    beforeEach(() => {
        // Load fresh module for each test
        module = loadSourceModule(paths.src.torbox);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('searchTracks - Torrent Search', () => {
        it('should return tracks from Torrentio API', async () => {
            const mockFetch = setupFetchMock({
                'torrentio-addon': {
                    status: 200,
                    data: fixtures.torrentio.success
                },
                'api.torbox.app': torboxSuccess({})
            });

            const context = {
                settings: { searchSource: { value: 'torrents' } }
            };

            const result = await module.searchTracks('Pink Floyd', 10, context);

            expect(result.tracks).toHaveLength(2);
            expect(result.tracks[0].title).toContain('Pink Floyd');
            expect(result.tracks[0].infoHash).toBeDefined();
            expect(result.source).toBe('torrents');
        });

        it('should handle empty results', async () => {
            setupFetchMock({
                'torrentio-addon': {
                    status: 200,
                    data: fixtures.torrentio.empty
                }
            });

            const context = {
                settings: { searchSource: { value: 'torrents' } }
            };

            const result = await module.searchTracks('nonexistent query', 10, context);

            expect(result.tracks).toHaveLength(0);
            expect(result.total).toBe(0);
        });

        it('should throw on API error', async () => {
            setupFetchMock({
                'torrentio-addon': {
                    status: 500,
                    data: { error: 'Server error' }
                }
            });

            const context = {
                settings: { searchSource: { value: 'torrents' } }
            };

            await expect(module.searchTracks('test', 10, context))
                .rejects.toThrow('Search failed');
        });

        it('should include cache status when debrid key provided', async () => {
            setupFetchMock({
                'torrentio-addon': {
                    status: 200,
                    data: fixtures.torrentio.success
                },
                'torrents/checkcached': torboxSuccess({
                    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0': true
                })
            });

            const context = {
                settings: {
                    searchSource: { value: 'torrents' },
                    torboxApiKey: { value: 'test-api-key' }
                },
                debridApiKey: 'test-api-key',
                debridProvider: 'torbox'
            };

            const result = await module.searchTracks('Pink Floyd', 10, context);

            // First track should be marked as cached
            const cachedTrack = result.tracks.find(t =>
                t.hash === 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
            );
            expect(cachedTrack.cached).toBe(true);
        });

        it('should respect limit parameter', async () => {
            // Create response with many results
            const manyResults = {
                results: Array(20).fill(null).map((_, i) => ({
                    title: `Track ${i}`,
                    infoHash: 'a'.repeat(40),
                    size: 1000000,
                    seeders: 10
                })),
                count: 20
            };

            setupFetchMock({
                'torrentio-addon': { status: 200, data: manyResults }
            });

            const context = {
                settings: { searchSource: { value: 'torrents' } }
            };

            // The API call should include the limit
            await module.searchTracks('test', 5, context);

            // Check that fetch was called with URL containing limit=5
            const calls = global.fetch.mock.calls;
            const searchCall = calls.find(c => c[0].includes('torrentio'));
            expect(searchCall[0]).toContain('limit=5');
        });
    });

    describe('searchTracks - Usenet Search', () => {
        it('should search TorBox usenet API', async () => {
            setupFetchMock({
                'search-api.torbox.app': {
                    status: 200,
                    data: fixtures.torboxSearch.success
                },
                'usenet/checkcached': torboxSuccess({})
            });

            const context = {
                settings: {
                    searchSource: { value: 'usenet-torbox' },
                    torboxApiKey: { value: 'test-key' }
                },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.searchTracks('Beatles', 10, context);

            expect(result.tracks).toHaveLength(1);
            expect(result.tracks[0].title).toContain('Beatles');
            expect(result.tracks[0].type).toBe('usenet');
            expect(result.source).toBe('usenet');
        });

        it('should throw error when no TorBox key for usenet', async () => {
            const context = {
                settings: { searchSource: { value: 'usenet-torbox' } }
            };

            await expect(module.searchTracks('test', 10, context))
                .rejects.toThrow('TorBox connection required');
        });
    });

    describe('searchTracks - Combined Search', () => {
        it('should search all sources with "both" setting', async () => {
            setupFetchMock({
                'torrentio-addon': {
                    status: 200,
                    data: fixtures.torrentio.success
                },
                'search-api.torbox.app': {
                    status: 200,
                    data: fixtures.torboxSearch.success
                },
                'checkcached': torboxSuccess({}),
                'prowlarr': {
                    status: 200,
                    data: []
                }
            });

            const context = {
                settings: {
                    searchSource: { value: 'both' },
                    torboxApiKey: { value: 'test-key' },
                    prowlarrUrl: { value: 'http://localhost:9696' },
                    prowlarrApiKey: { value: 'prowlarr-key' }
                },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.searchTracks('music', 20, context);

            expect(result.source).toBe('all');
            expect(result.tracks.length).toBeGreaterThan(0);
        });
    });
});

describe('Torbox Module - Track Structure', () => {
    let module;

    beforeEach(() => {
        const paths = getModulePaths();
        module = loadSourceModule(paths.src.torbox);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should return tracks with required fields', async () => {
        setupFetchMock({
            'torrentio-addon': {
                status: 200,
                data: fixtures.torrentio.success
            }
        });

        const context = {
            settings: { searchSource: { value: 'torrents' } }
        };

        const result = await module.searchTracks('test', 10, context);
        const track = result.tracks[0];

        // Required fields
        expect(track).toHaveProperty('id');
        expect(track).toHaveProperty('title');
        expect(track).toHaveProperty('artist');
        expect(track).toHaveProperty('album');
        expect(track).toHaveProperty('duration');
        expect(track).toHaveProperty('trackNumber');
        expect(track).toHaveProperty('audioQuality');

        // Torrent-specific fields
        expect(track).toHaveProperty('infoHash');
        expect(track).toHaveProperty('hash');
        expect(track).toHaveProperty('seeders');
        expect(track).toHaveProperty('source');
    });

    it('should generate unique IDs for tracks', async () => {
        setupFetchMock({
            'torrentio-addon': {
                status: 200,
                data: fixtures.torrentio.success
            }
        });

        const context = {
            settings: { searchSource: { value: 'torrents' } }
        };

        const result = await module.searchTracks('test', 10, context);

        const ids = result.tracks.map(t => t.id);
        const uniqueIds = new Set(ids);

        expect(uniqueIds.size).toBe(ids.length);
    });

    it('should prefix torrent IDs with "tor:"', async () => {
        setupFetchMock({
            'torrentio-addon': {
                status: 200,
                data: fixtures.torrentio.success
            }
        });

        const context = {
            settings: { searchSource: { value: 'torrents' } }
        };

        const result = await module.searchTracks('test', 10, context);

        for (const track of result.tracks) {
            if (track.infoHash) {
                expect(track.id).toMatch(/^tor:/);
            }
        }
    });
});
