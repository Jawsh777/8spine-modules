const { extractFunctions, getModulePaths } = require('../helpers/moduleLoader');

describe('Cerberus Module - Utility Functions', () => {
    let utils;

    beforeAll(() => {
        const paths = getModulePaths();
        utils = extractFunctions(paths.src.cerberus, [
            'extractStreamUrl',
            'getTidalCoverUrl',
        ]);
    });

    describe('extractStreamUrl', () => {
        it('should extract URL from base64-encoded manifest', () => {
            // Create a base64-encoded JSON with urls array
            const manifest = {
                urls: ['https://stream.tidal.com/audio/track123.flac']
            };
            const encoded = btoa(JSON.stringify(manifest));

            expect(utils.extractStreamUrl(encoded)).toBe('https://stream.tidal.com/audio/track123.flac');
        });

        it('should return first URL when multiple are present', () => {
            const manifest = {
                urls: [
                    'https://stream1.tidal.com/track.flac',
                    'https://stream2.tidal.com/track.flac'
                ]
            };
            const encoded = btoa(JSON.stringify(manifest));

            expect(utils.extractStreamUrl(encoded)).toBe('https://stream1.tidal.com/track.flac');
        });

        it('should return null for null manifest', () => {
            expect(utils.extractStreamUrl(null)).toBe(null);
            expect(utils.extractStreamUrl(undefined)).toBe(null);
        });

        it('should return null for empty urls array', () => {
            const manifest = { urls: [] };
            const encoded = btoa(JSON.stringify(manifest));

            expect(utils.extractStreamUrl(encoded)).toBe(null);
        });

        it('should return null for invalid base64', () => {
            expect(utils.extractStreamUrl('not-valid-base64!!!')).toBe(null);
        });

        it('should return null for invalid JSON', () => {
            const encoded = btoa('not valid json');
            expect(utils.extractStreamUrl(encoded)).toBe(null);
        });

        it('should return null for manifest without urls property', () => {
            const manifest = { data: 'something else' };
            const encoded = btoa(JSON.stringify(manifest));

            expect(utils.extractStreamUrl(encoded)).toBe(null);
        });
    });

    describe('getTidalCoverUrl', () => {
        it('should convert UUID to Tidal cover URL', () => {
            const uuid = '12345678-1234-1234-1234-123456789abc';
            const expected = 'https://resources.tidal.com/images/12345678/1234/1234/1234/123456789abc/640x640.jpg';

            expect(utils.getTidalCoverUrl(uuid)).toBe(expected);
        });

        it('should return null for null/undefined input', () => {
            expect(utils.getTidalCoverUrl(null)).toBe(null);
            expect(utils.getTidalCoverUrl(undefined)).toBe(null);
        });

        it('should return URL as-is if already a full URL', () => {
            const url = 'https://example.com/cover.jpg';
            expect(utils.getTidalCoverUrl(url)).toBe(url);
        });

        it('should return non-UUID strings as-is', () => {
            const notUuid = 'some-random-string';
            expect(utils.getTidalCoverUrl(notUuid)).toBe(notUuid);
        });

        it('should handle lowercase UUID', () => {
            const uuid = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
            const expected = 'https://resources.tidal.com/images/abcdefab/abcd/abcd/abcd/abcdefabcdef/640x640.jpg';

            expect(utils.getTidalCoverUrl(uuid)).toBe(expected);
        });

        it('should handle uppercase UUID', () => {
            const uuid = 'ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF';
            const expected = 'https://resources.tidal.com/images/ABCDEFAB/ABCD/ABCD/ABCD/ABCDEFABCDEF/640x640.jpg';

            expect(utils.getTidalCoverUrl(uuid)).toBe(expected);
        });
    });
});
