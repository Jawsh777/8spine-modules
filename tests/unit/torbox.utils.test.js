const { extractFunctions, getModulePaths } = require('../helpers/moduleLoader');

// Pre-load module once at module level to avoid timing issues
const paths = getModulePaths();
const utils = extractFunctions(paths.src.torbox, [
    'sanitizeQuery',
    'validateHash',
    'extractHash',
    'parseTorrentName',
    'normalizeMagnetPrefix',
    'extractArtistFromTitle',
    'formatBytes',
    'extractFilenameFromSubject',
    'mapProviderName',
]);

describe('Torbox Module - Utility Functions', () => {

    describe('sanitizeQuery', () => {
        it('should trim whitespace from query', () => {
            expect(utils.sanitizeQuery('  hello world  ')).toBe('hello world');
        });

        it('should throw error for empty string query', () => {
            // Empty string is falsy, caught by first check
            expect(() => utils.sanitizeQuery('')).toThrow('Invalid search query');
        });

        it('should throw error for whitespace-only query', () => {
            // Whitespace-only passes first check but fails after trim
            expect(() => utils.sanitizeQuery('   ')).toThrow('Please enter a search query');
        });

        it('should throw error for null/undefined query', () => {
            expect(() => utils.sanitizeQuery(null)).toThrow('Invalid search query');
            expect(() => utils.sanitizeQuery(undefined)).toThrow('Invalid search query');
        });

        it('should throw error for non-string query', () => {
            expect(() => utils.sanitizeQuery(123)).toThrow('Invalid search query');
            expect(() => utils.sanitizeQuery({})).toThrow('Invalid search query');
        });

        it('should throw error for query exceeding max length', () => {
            const longQuery = 'a'.repeat(501);
            expect(() => utils.sanitizeQuery(longQuery)).toThrow('Search query too long');
        });

        it('should remove dangerous characters', () => {
            expect(utils.sanitizeQuery('hello <script> world')).toBe('hello script world');
            expect(utils.sanitizeQuery('test > value')).toBe('test  value');
        });

        it('should accept query at max length', () => {
            const maxQuery = 'a'.repeat(500);
            expect(utils.sanitizeQuery(maxQuery)).toBe(maxQuery);
        });
    });

    describe('validateHash', () => {
        it('should validate V1 SHA-1 hash (40 hex chars)', () => {
            const validV1 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
            expect(utils.validateHash(validV1)).toBe(true);
        });

        it('should validate V1 hash case-insensitively', () => {
            const upperHash = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0';
            expect(utils.validateHash(upperHash)).toBe(true);
        });

        it('should validate V2 Base32 hash (32 chars)', () => {
            const validV2 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
            expect(utils.validateHash(validV2)).toBe(true);
        });

        it('should reject invalid hash lengths', () => {
            expect(utils.validateHash('abc123')).toBe(false);
            expect(utils.validateHash('a'.repeat(39))).toBe(false);
            expect(utils.validateHash('a'.repeat(41))).toBe(false);
        });

        it('should reject invalid characters in V1 hash', () => {
            const invalidV1 = 'g1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'; // 'g' is invalid
            expect(utils.validateHash(invalidV1)).toBe(false);
        });

        it('should reject null/undefined', () => {
            expect(utils.validateHash(null)).toBe(false);
            expect(utils.validateHash(undefined)).toBe(false);
            expect(utils.validateHash('')).toBe(false);
        });
    });

    describe('extractHash', () => {
        it('should extract V1 hash from magnet link', () => {
            const magnet = 'magnet:?xt=urn:btih:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0&dn=Test';
            expect(utils.extractHash(magnet)).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
        });

        it('should extract hash and lowercase it', () => {
            const magnet = 'magnet:?xt=urn:btih:A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0&dn=Test';
            expect(utils.extractHash(magnet)).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
        });

        it('should return null for invalid magnet', () => {
            expect(utils.extractHash('not a magnet')).toBe(null);
            expect(utils.extractHash('')).toBe(null);
            expect(utils.extractHash(null)).toBe(null);
        });

        it('should return null for magnet with invalid hash', () => {
            const magnet = 'magnet:?xt=urn:btih:tooshort&dn=Test';
            expect(utils.extractHash(magnet)).toBe(null);
        });
    });

    describe('parseTorrentName', () => {
        it('should parse artist and album from hyphenated name', () => {
            const result = utils.parseTorrentName('Pink Floyd - The Dark Side of the Moon');
            expect(result.artist).toBe('Pink Floyd');
            expect(result.album).toBe('The Dark Side of the Moon');
        });

        it('should extract quality from name', () => {
            const result = utils.parseTorrentName('Artist - Album [FLAC]');
            expect(result.quality).toBe('FLAC');
        });

        it('should handle MP3 quality', () => {
            const result = utils.parseTorrentName('Artist - Album [MP3 320]');
            expect(result.quality).toBe('MP3');
        });

        it('should handle 24bit quality', () => {
            const result = utils.parseTorrentName('Artist - Album [24bit FLAC]');
            expect(result.quality).toBe('24BIT');
        });

        it('should remove bracketed content from artist/album', () => {
            const result = utils.parseTorrentName('[2024] Artist - Album (Deluxe)');
            expect(result.artist).toBe('Artist');
        });

        it('should handle names without hyphen', () => {
            const result = utils.parseTorrentName('Album Name Only');
            expect(result.artist).toBe(null);
            expect(result.album).toBe('Album Name Only');
        });

        it('should return nulls for empty/null input', () => {
            expect(utils.parseTorrentName(null)).toEqual({ artist: null, album: null, quality: null });
            expect(utils.parseTorrentName('')).toEqual({ artist: null, album: null, quality: null });
        });
    });

    describe('normalizeMagnetPrefix', () => {
        it('should fix double magnet: prefix', () => {
            const doubleMagnet = 'magnet:magnet:?xt=urn:btih:abc123';
            expect(utils.normalizeMagnetPrefix(doubleMagnet)).toBe('magnet:?xt=urn:btih:abc123');
        });

        it('should leave normal magnet unchanged', () => {
            const normalMagnet = 'magnet:?xt=urn:btih:abc123';
            expect(utils.normalizeMagnetPrefix(normalMagnet)).toBe(normalMagnet);
        });

        it('should handle null/undefined', () => {
            expect(utils.normalizeMagnetPrefix(null)).toBe(null);
            expect(utils.normalizeMagnetPrefix(undefined)).toBe(undefined);
        });
    });

    describe('extractArtistFromTitle', () => {
        it('should extract artist before hyphen', () => {
            expect(utils.extractArtistFromTitle('Pink Floyd - Wish You Were Here')).toBe('Pink Floyd');
        });

        it('should remove bracketed content from artist', () => {
            expect(utils.extractArtistFromTitle('[FLAC] Pink Floyd - Album')).toBe('Pink Floyd');
        });

        it('should return null for titles without hyphen', () => {
            expect(utils.extractArtistFromTitle('No Hyphen Here')).toBe(null);
        });

        it('should return null for null/empty input', () => {
            expect(utils.extractArtistFromTitle(null)).toBe(null);
            expect(utils.extractArtistFromTitle('')).toBe(null);
        });
    });

    describe('formatBytes', () => {
        it('should format 0 bytes', () => {
            expect(utils.formatBytes(0)).toBe('0 Bytes');
        });

        it('should format bytes', () => {
            expect(utils.formatBytes(500)).toBe('500 Bytes');
        });

        it('should format kilobytes', () => {
            expect(utils.formatBytes(1024)).toBe('1 KB');
            expect(utils.formatBytes(1536)).toBe('1.5 KB');
        });

        it('should format megabytes', () => {
            expect(utils.formatBytes(1048576)).toBe('1 MB');
            expect(utils.formatBytes(157286400)).toBe('150 MB');
        });

        it('should format gigabytes', () => {
            expect(utils.formatBytes(1073741824)).toBe('1 GB');
        });

        it('should format terabytes', () => {
            expect(utils.formatBytes(1099511627776)).toBe('1 TB');
        });
    });

    describe('extractFilenameFromSubject', () => {
        it('should extract audio filename from NZB subject', () => {
            const subject = 'Artist - Track.mp3 (1/5)';
            expect(utils.extractFilenameFromSubject(subject)).toBe('Track.mp3');
        });

        it('should extract FLAC filename', () => {
            const subject = '01 - Song Title.flac yEnc (1/50)';
            expect(utils.extractFilenameFromSubject(subject)).toBe('Title.flac');
        });

        it('should remove segment counters', () => {
            const subject = 'File.mp3 (15/20)';
            const result = utils.extractFilenameFromSubject(subject);
            expect(result).not.toContain('(15/20)');
        });

        it('should return null for null input', () => {
            expect(utils.extractFilenameFromSubject(null)).toBe(null);
        });
    });

    describe('mapProviderName', () => {
        it('should map known providers', () => {
            expect(utils.mapProviderName('torbox')).toBe('torbox');
            expect(utils.mapProviderName('realdebrid')).toBe('realdebrid');
            expect(utils.mapProviderName('premiumize')).toBe('premiumize');
        });

        it('should return unknown providers as-is', () => {
            expect(utils.mapProviderName('unknown')).toBe('unknown');
            expect(utils.mapProviderName('newprovider')).toBe('newprovider');
        });
    });
});
