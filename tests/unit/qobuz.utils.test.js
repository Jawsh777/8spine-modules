const { extractFunctions, getModulePaths } = require('../helpers/moduleLoader');

describe('Qobuz Module - Utility Functions', () => {
    let utils;

    beforeAll(() => {
        const paths = getModulePaths();
        utils = extractFunctions(paths.src.qobuz, [
            'buildTrackTitle',
            'buildAlbumTitle',
            'determineAudioQuality',
        ]);
    });

    describe('buildTrackTitle', () => {
        it('should return track title', () => {
            const track = { title: 'Bohemian Rhapsody' };
            expect(utils.buildTrackTitle(track)).toBe('Bohemian Rhapsody');
        });

        it('should append version in parentheses', () => {
            const track = { title: 'Bohemian Rhapsody', version: '2011 Remaster' };
            expect(utils.buildTrackTitle(track)).toBe('Bohemian Rhapsody (2011 Remaster)');
        });

        it('should return "Unknown Track" for null track', () => {
            expect(utils.buildTrackTitle(null)).toBe('Unknown Track');
            expect(utils.buildTrackTitle(undefined)).toBe('Unknown Track');
        });

        it('should return "Unknown Track" for track without title', () => {
            expect(utils.buildTrackTitle({})).toBe('Unknown Track');
            expect(utils.buildTrackTitle({ version: 'Remaster' })).toBe('Unknown Track (Remaster)');
        });
    });

    describe('buildAlbumTitle', () => {
        it('should return album title', () => {
            const album = { title: 'A Night at the Opera' };
            expect(utils.buildAlbumTitle(album)).toBe('A Night at the Opera');
        });

        it('should append version in parentheses', () => {
            const album = { title: 'A Night at the Opera', version: 'Deluxe Edition' };
            expect(utils.buildAlbumTitle(album)).toBe('A Night at the Opera (Deluxe Edition)');
        });

        it('should return "Unknown Album" for null album', () => {
            expect(utils.buildAlbumTitle(null)).toBe('Unknown Album');
            expect(utils.buildAlbumTitle(undefined)).toBe('Unknown Album');
        });

        it('should return "Unknown Album" for album without title', () => {
            expect(utils.buildAlbumTitle({})).toBe('Unknown Album');
        });
    });

    describe('determineAudioQuality', () => {
        it('should return "Unknown" for null track', () => {
            expect(utils.determineAudioQuality(null)).toBe('Unknown');
            expect(utils.determineAudioQuality(undefined)).toBe('Unknown');
        });

        it('should return maximum_technical_specifications if available', () => {
            const track = {
                maximum_technical_specifications: '24-bit / 96 kHz - Stereo'
            };
            expect(utils.determineAudioQuality(track)).toBe('24-bit / 96 kHz - Stereo');
        });

        it('should build quality string from individual fields', () => {
            const track = {
                maximum_bit_depth: 24,
                maximum_sampling_rate: 96,
                maximum_channel_count: 2
            };
            expect(utils.determineAudioQuality(track)).toBe('24 bits / 96 kHz - Stereo');
        });

        it('should handle missing fields with question marks', () => {
            const track = {};
            expect(utils.determineAudioQuality(track)).toBe('? bits / ? kHz - Unknown');
        });

        it('should handle non-stereo channel count', () => {
            const track = {
                maximum_bit_depth: 16,
                maximum_sampling_rate: 44.1,
                maximum_channel_count: 6
            };
            expect(utils.determineAudioQuality(track)).toBe('16 bits / 44.1 kHz - Unknown');
        });
    });
});
