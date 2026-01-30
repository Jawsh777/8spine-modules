const { loadSourceModule, getModulePaths } = require('../helpers/moduleLoader');
const { setupFetchMock, torboxSuccess, torboxError } = require('../helpers/mockFetch');
const torrentFixtures = require('../fixtures/torrentInfo.json');

describe('Torbox Module - Stream URL Retrieval', () => {
    let module;
    const paths = getModulePaths();

    beforeEach(() => {
        module = loadSourceModule(paths.src.torbox);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getTrackStreamUrl - Torrent', () => {
        it('should resolve stream URL via debrid API', async () => {
            setupFetchMock({
                'music/debrid': {
                    status: 200,
                    data: {
                        success: true,
                        downloadUrl: 'https://download.example.com/stream.flac'
                    }
                }
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getTrackStreamUrl(
                'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                'high',
                context
            );

            expect(result.streamUrl).toBe('https://download.example.com/stream.flac');
            expect(result.track).toBeDefined();
            expect(result.track.id).toContain('tor:');
        });

        it('should throw error when no debrid key', async () => {
            const context = {};

            await expect(
                module.getTrackStreamUrl('tor:abc123', 'high', context)
            ).rejects.toThrow('Debrid connection required');
        });

        it('should handle API failure gracefully', async () => {
            setupFetchMock({
                'music/debrid': {
                    status: 500,
                    data: { error: 'Server error' }
                },
                'torrents/createtorrent': torboxError('Failed', 500),
                'music/magnet': { status: 404, data: {} }
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            await expect(
                module.getTrackStreamUrl('tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', 'high', context)
            ).rejects.toThrow();
        });

        it('should extract hash from tor: prefix', async () => {
            setupFetchMock({
                'music/debrid': {
                    status: 200,
                    data: {
                        success: true,
                        downloadUrl: 'https://download.example.com/stream.flac'
                    }
                }
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            await module.getTrackStreamUrl(
                'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                'high',
                context
            );

            // Verify the API was called with the correct hash
            expect(global.fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    body: expect.stringContaining('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')
                })
            );
        });
    });

    describe('getTrackStreamUrl - Usenet', () => {
        it('should resolve usenet stream URL', async () => {
            setupFetchMock({
                'usenet/mylist': torboxSuccess([{
                    id: 67890,
                    hash: 'abc123',
                    download_state: 'cached',
                    files: [{
                        id: 10,
                        name: 'track.flac',
                        size: 50000000
                    }]
                }]),
                'usenet/requestdl': torboxSuccess('https://download.torbox.app/usenet/track.flac')
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getTrackStreamUrl(
                'nzb:abc123',
                'high',
                context
            );

            expect(result.streamUrl).toBeDefined();
        });

        it('should handle prowlarr-nzb: prefix', async () => {
            setupFetchMock({
                'usenet/mylist': torboxSuccess([{
                    id: 67890,
                    hash: 'xyz789',
                    download_state: 'cached',
                    files: [{
                        id: 10,
                        name: 'track.flac',
                        size: 50000000
                    }]
                }]),
                'usenet/requestdl': torboxSuccess('https://download.torbox.app/usenet/track.flac')
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getTrackStreamUrl(
                'prowlarr-nzb:xyz789',
                'high',
                context
            );

            expect(result.streamUrl).toBeDefined();
        });

        it('should throw error for non-TorBox provider with usenet', async () => {
            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'realdebrid'
            };

            await expect(
                module.getTrackStreamUrl('nzb:abc123', 'high', context)
            ).rejects.toThrow('not supported');
        });
    });

    describe('getTrackStreamUrl - Magnet Links', () => {
        it('should handle magnet: prefix in track ID', async () => {
            setupFetchMock({
                'music/debrid': {
                    status: 200,
                    data: {
                        success: true,
                        downloadUrl: 'https://download.example.com/stream.flac'
                    }
                }
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const magnet = 'magnet:?xt=urn:btih:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0&dn=Test';

            const result = await module.getTrackStreamUrl(magnet, 'high', context);

            expect(result.streamUrl).toBeDefined();
        });
    });
});

describe('Torbox Module - Stream URL Caching', () => {
    let module;

    beforeEach(() => {
        const paths = getModulePaths();
        module = loadSourceModule(paths.src.torbox);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should cache stream URLs', async () => {
        let callCount = 0;

        setupFetchMock({
            'music/debrid': () => {
                callCount++;
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        success: true,
                        downloadUrl: 'https://download.example.com/stream.flac'
                    }),
                    text: async () => JSON.stringify({
                        success: true,
                        downloadUrl: 'https://download.example.com/stream.flac'
                    })
                };
            }
        });

        const context = {
            debridApiKey: 'test-key',
            debridProvider: 'torbox'
        };

        // First call
        await module.getTrackStreamUrl(
            'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
            'high',
            context
        );

        // Second call with same track - should use cache
        await module.getTrackStreamUrl(
            'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
            'high',
            context
        );

        // API should only be called once due to caching
        expect(callCount).toBe(1);
    });
});
