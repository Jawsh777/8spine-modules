const { loadSourceModule, getModulePaths } = require('../helpers/moduleLoader');
const { setupFetchMock, torboxSuccess, torboxError } = require('../helpers/mockFetch');
const torrentFixtures = require('../fixtures/torrentInfo.json');

describe('Torbox Module - Cloud Management', () => {
    let module;
    const paths = getModulePaths();

    beforeEach(() => {
        module = loadSourceModule(paths.src.torbox);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('addToCloud - Torrent', () => {
        it('should add torrent to TorBox', async () => {
            setupFetchMock({
                'torrents/createtorrent': torboxSuccess({ torrent_id: 12345 })
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const track = {
                id: 'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                infoHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                magnet: 'magnet:?xt=urn:btih:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
            };

            const result = await module.addToCloud(track, context);

            expect(result.success).toBe(true);
            expect(result.message).toContain('TorBox');
        });

        it('should handle "already exists" response', async () => {
            setupFetchMock({
                'torrents/createtorrent': {
                    status: 400,
                    data: { success: false, detail: 'Torrent already exists' }
                }
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const track = {
                id: 'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                magnet: 'magnet:?xt=urn:btih:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
            };

            const result = await module.addToCloud(track, context);

            expect(result.success).toBe(true);
            expect(result.message).toContain('already exists');
        });

        it('should throw error without debrid key', async () => {
            const context = {};
            const track = {
                id: 'tor:abc123',
                magnet: 'magnet:?xt=urn:btih:abc123'
            };

            await expect(module.addToCloud(track, context))
                .rejects.toThrow('TorBox connection required');
        });

        it('should add to Real-Debrid when configured', async () => {
            setupFetchMock({
                'addMagnet': {
                    status: 200,
                    data: { id: 'rd123' }
                },
                'selectFiles': {
                    status: 204,
                    data: {}
                }
            });

            const context = {
                debridApiKey: 'test-rd-key',
                debridProvider: 'realdebrid'
            };

            const track = {
                id: 'tor:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                magnet: 'magnet:?xt=urn:btih:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
            };

            const result = await module.addToCloud(track, context);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Real-Debrid');
        });
    });

    describe('addToCloud - Usenet', () => {
        it('should add NZB to TorBox usenet', async () => {
            setupFetchMock({
                'usenet/createusenetdownload': torboxSuccess({ usenet_id: 67890 })
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const track = {
                id: 'nzb:abc123',
                type: 'usenet',
                nzb: 'https://indexer.example.com/nzb/abc123.nzb'
            };

            const result = await module.addToCloud(track, context);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Usenet');
        });

        it('should throw error for usenet with non-TorBox provider', async () => {
            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'realdebrid'
            };

            const track = {
                id: 'nzb:abc123',
                type: 'usenet',
                nzb: 'https://example.com/nzb.nzb'
            };

            await expect(module.addToCloud(track, context))
                .rejects.toThrow('not supported');
        });

        it('should throw error when NZB URL is missing', async () => {
            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const track = {
                id: 'nzb:abc123',
                type: 'usenet'
                // nzb field missing
            };

            await expect(module.addToCloud(track, context))
                .rejects.toThrow('No NZB URL');
        });
    });

    describe('getCloudAlbums', () => {
        it('should fetch both torrents and usenet downloads', async () => {
            setupFetchMock({
                'torrents/mylist': torboxSuccess(torrentFixtures.torbox.torrentList.data),
                'usenet/mylist': torboxSuccess(torrentFixtures.torbox.usenetList.data)
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getCloudAlbums(context);

            expect(result.albums).toBeDefined();
            expect(Array.isArray(result.albums)).toBe(true);
            expect(result.provider).toBe('torbox');

            // Should have both torrent and usenet items
            const types = result.albums.map(a => a.type);
            expect(types).toContain('torrent');
            expect(types).toContain('usenet');
        });

        it('should return empty albums when no TorBox key', async () => {
            const context = {};

            const result = await module.getCloudAlbums(context);

            expect(result.albums).toEqual([]);
            expect(result.provider).toBe(null);
        });

        it('should filter out video content', async () => {
            const mixedContent = [
                { id: 1, name: 'Music Album [FLAC]', size: 1000000 },
                { id: 2, name: 'Movie.2024.1080p.BluRay', size: 5000000 },
                { id: 3, name: 'TV.Show.S01E01.HDTV', size: 3000000 }
            ];

            setupFetchMock({
                'torrents/mylist': torboxSuccess(mixedContent),
                'usenet/mylist': torboxSuccess([])
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getCloudAlbums(context);

            // Should only include music content
            expect(result.albums.length).toBe(1);
            expect(result.albums[0].name).toContain('Music Album');
        });

        it('should sort albums by date (newest first)', async () => {
            const albums = [
                { id: 1, name: 'Old Album', created_at: '2024-01-01T00:00:00Z' },
                { id: 2, name: 'New Album', created_at: '2024-06-01T00:00:00Z' },
                { id: 3, name: 'Mid Album', created_at: '2024-03-01T00:00:00Z' }
            ];

            setupFetchMock({
                'torrents/mylist': torboxSuccess(albums),
                'usenet/mylist': torboxSuccess([])
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.getCloudAlbums(context);

            expect(result.albums[0].name).toBe('New Album');
            expect(result.albums[1].name).toBe('Mid Album');
            expect(result.albums[2].name).toBe('Old Album');
        });
    });

    describe('checkCached', () => {
        it('should check cache status for hashes', async () => {
            setupFetchMock({
                'torrents/checkcached': torboxSuccess({
                    'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0': true,
                    'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1': false
                })
            });

            const context = {
                settings: { torboxApiKey: { value: 'test-key' } },
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const hashes = [
                'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
                'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1'
            ];

            const result = await module.checkCached(hashes, context);

            expect(result['a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0']).toBe(true);
            expect(result['b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1']).toBe(false);
        });

        it('should return empty object when no debrid key', async () => {
            const context = {};
            const hashes = ['abc123'];

            const result = await module.checkCached(hashes, context);

            expect(result).toEqual({});
        });

        it('should return empty object for empty hash array', async () => {
            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const result = await module.checkCached([], context);

            expect(result).toEqual({});
        });

        it('should filter out invalid hashes', async () => {
            setupFetchMock({
                'torrents/checkcached': torboxSuccess({})
            });

            const context = {
                debridApiKey: 'test-key',
                debridProvider: 'torbox'
            };

            const hashes = [
                'tooshort',
                'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', // valid
                null,
                undefined
            ];

            await module.checkCached(hashes, context);

            // Should only send the valid hash
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'),
                expect.anything()
            );
        });
    });

    describe('verifyTorBoxKey', () => {
        it('should verify valid API key', async () => {
            setupFetchMock({
                'user/me': {
                    status: 200,
                    data: torrentFixtures.torbox.userInfo
                }
            });

            const result = await module.verifyTorBoxKey('valid-api-key');

            expect(result.success).toBe(true);
            expect(result.accountName).toBeDefined();
            expect(result.plan).toBeDefined();
        });

        it('should return error for invalid API key', async () => {
            setupFetchMock({
                'user/me': {
                    status: 401,
                    data: { success: false, detail: 'Invalid API key' }
                }
            });

            const result = await module.verifyTorBoxKey('invalid-key');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle network errors', async () => {
            setupFetchMock({
                'user/me': { error: 'Network error' }
            });

            const result = await module.verifyTorBoxKey('any-key');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
        });
    });
});
