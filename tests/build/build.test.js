const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Import build functions by requiring the build script
// We'll test the functions by examining their behavior

const BUILD_SCRIPT = path.resolve(__dirname, '../../scripts/build-ts.ts');
const SRC_DIR = path.resolve(__dirname, '../../src');
const DIST_DIR = path.resolve(__dirname, '../../dist');

describe('Build Script - Integration', () => {
    describe('escapeForTemplate', () => {
        // Test the escaping logic by building a file and checking output
        it('should escape backticks in output', () => {
            const distFile = path.join(DIST_DIR, 'torbox.8spine');

            // Ensure build has run
            if (!fs.existsSync(distFile)) {
                execSync('npm run build', { cwd: path.resolve(__dirname, '../..') });
            }

            const content = fs.readFileSync(distFile, 'utf8');

            // The content should be wrapped in template literal
            expect(content).toMatch(/^export const \w+ = `/);
            expect(content).toMatch(/`;\s*$/);

            // Any backticks inside should be escaped
            // Extract the inner content
            const match = content.match(/^export const \w+ = `([\s\S]+)`;\s*$/);
            expect(match).not.toBe(null);

            const innerContent = match[1];
            // Backticks should be escaped as \`
            // Unescaped backticks would break the template literal
        });

        it('should escape template interpolations', () => {
            const distFile = path.join(DIST_DIR, 'torbox.8spine');

            if (!fs.existsSync(distFile)) {
                execSync('npm run build', { cwd: path.resolve(__dirname, '../..') });
            }

            const content = fs.readFileSync(distFile, 'utf8');

            // Template interpolations like ${...} should be escaped as \${...}
            // This prevents them from being evaluated when the module is loaded
            // We can check that the file doesn't have unescaped ${
            const match = content.match(/^export const \w+ = `([\s\S]+)`;\s*$/);
            const innerContent = match[1];

            // All ${ sequences should be escaped to \${
            // Count unescaped ${ (not preceded by \)
            const unescapedInterpolations = innerContent.match(/(?<!\\)\$\{/g);
            expect(unescapedInterpolations).toBe(null);
        });
    });

    describe('extractExportName', () => {
        it('should extract export name from source files', () => {
            const srcFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.ts'));

            for (const file of srcFiles) {
                const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
                const match = content.match(/^\/\/\s*@8spine-export\s+(\w+)/m);

                expect(match).not.toBe(null);
                expect(match[1]).toMatch(/^[A-Z_]+$/); // Export names are uppercase
            }
        });

        it('torbox.ts should export GLOBAL_SEARCH_MODULE_CODE', () => {
            const content = fs.readFileSync(path.join(SRC_DIR, 'torbox.ts'), 'utf8');
            expect(content).toMatch(/@8spine-export\s+GLOBAL_SEARCH_MODULE_CODE/);
        });

        it('qobuz.ts should export QOBUZ_MODULE_CODE', () => {
            const content = fs.readFileSync(path.join(SRC_DIR, 'qobuz.ts'), 'utf8');
            expect(content).toMatch(/@8spine-export\s+QOBUZ_MODULE_CODE/);
        });

        it('cerberus.ts should export CERBERUS_MODULE_CODE', () => {
            const content = fs.readFileSync(path.join(SRC_DIR, 'cerberus.ts'), 'utf8');
            expect(content).toMatch(/@8spine-export\s+CERBERUS_MODULE_CODE/);
        });
    });

    describe('buildModule', () => {
        beforeAll(() => {
            // Ensure fresh build
            execSync('npm run build', {
                cwd: path.resolve(__dirname, '../..'),
                stdio: 'pipe'
            });
        });

        it('should create .8spine files in dist/', () => {
            expect(fs.existsSync(path.join(DIST_DIR, 'torbox.8spine'))).toBe(true);
            expect(fs.existsSync(path.join(DIST_DIR, 'qobuz.8spine'))).toBe(true);
            expect(fs.existsSync(path.join(DIST_DIR, 'cerberus.8spine'))).toBe(true);
        });

        it('should use correct export name from directive', () => {
            const torbox = fs.readFileSync(path.join(DIST_DIR, 'torbox.8spine'), 'utf8');
            expect(torbox).toMatch(/^export const GLOBAL_SEARCH_MODULE_CODE = `/);

            const qobuz = fs.readFileSync(path.join(DIST_DIR, 'qobuz.8spine'), 'utf8');
            expect(qobuz).toMatch(/^export const QOBUZ_MODULE_CODE = `/);

            const cerberus = fs.readFileSync(path.join(DIST_DIR, 'cerberus.8spine'), 'utf8');
            expect(cerberus).toMatch(/^export const CERBERUS_MODULE_CODE = `/);
        });

        it('should remove @8spine-export directive from output', () => {
            const files = ['torbox.8spine', 'qobuz.8spine', 'cerberus.8spine'];

            for (const file of files) {
                const content = fs.readFileSync(path.join(DIST_DIR, file), 'utf8');
                expect(content).not.toContain('@8spine-export');
            }
        });

        it('built modules should be evaluable', () => {
            const { loadBuiltModule, getModulePaths } = require('../helpers/moduleLoader');
            const paths = getModulePaths();

            // Each built module should return a valid module object
            const torbox = loadBuiltModule(paths.dist.torbox);
            expect(torbox).toHaveProperty('id');
            expect(torbox).toHaveProperty('name');
            expect(torbox).toHaveProperty('version');
            expect(torbox).toHaveProperty('searchTracks');

            const qobuz = loadBuiltModule(paths.dist.qobuz);
            expect(qobuz).toHaveProperty('id', 'qobuz');
            expect(qobuz).toHaveProperty('searchTracks');

            const cerberus = loadBuiltModule(paths.dist.cerberus);
            expect(cerberus).toHaveProperty('id', 'cerberus');
            expect(cerberus).toHaveProperty('searchTracks');
        });
    });

    describe('build CLI', () => {
        it('should show help with --help flag', () => {
            const output = execSync('npm run build -- --help', {
                cwd: path.resolve(__dirname, '../..'),
                encoding: 'utf8'
            });

            expect(output).toContain('8spine');
            expect(output).toContain('--watch');
            expect(output).toContain('--help');
        });
    });
});

describe('Build Script - Module Format Validation', () => {
    const { loadBuiltModule, getModulePaths } = require('../helpers/moduleLoader');
    const paths = getModulePaths();

    describe('torbox module structure', () => {
        let module;

        beforeAll(() => {
            module = loadBuiltModule(paths.dist.torbox);
        });

        it('should have required metadata', () => {
            expect(module.id).toBe('music-torrent-search');
            expect(module.name).toBe('Torrentio Music');
            expect(module.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(module.description).toBeDefined();
            expect(module.logo).toMatch(/^https?:\/\//);
            expect(Array.isArray(module.labels)).toBe(true);
        });

        it('should export required functions', () => {
            expect(typeof module.searchTracks).toBe('function');
            expect(typeof module.getTrackStreamUrl).toBe('function');
            expect(typeof module.addToCloud).toBe('function');
            expect(typeof module.verifyTorBoxKey).toBe('function');
            expect(typeof module.checkCached).toBe('function');
            expect(typeof module.getCloudAlbums).toBe('function');
        });

        it('should have settings schema', () => {
            expect(module.settings).toBeDefined();
            expect(module.settings.torboxApiKey).toBeDefined();
            expect(module.settings.torboxApiKey.type).toBe('debrid');
            expect(module.settings.searchSource).toBeDefined();
            expect(module.settings.searchSource.type).toBe('selector');
        });
    });

    describe('qobuz module structure', () => {
        let module;

        beforeAll(() => {
            module = loadBuiltModule(paths.dist.qobuz);
        });

        it('should have required metadata', () => {
            expect(module.id).toBe('qobuz');
            expect(module.name).toContain('Qobuz');
            expect(module.version).toMatch(/^\d+\.\d+\.\d+$/);
        });

        it('should export required functions', () => {
            expect(typeof module.searchTracks).toBe('function');
            expect(typeof module.getTrackStreamUrl).toBe('function');
            expect(typeof module.getAlbum).toBe('function');
        });

        it('should have quality settings', () => {
            expect(module.settings.quality).toBeDefined();
            expect(module.settings.quality.type).toBe('selector');
            expect(Array.isArray(module.settings.quality.options)).toBe(true);
        });
    });

    describe('cerberus module structure', () => {
        let module;

        beforeAll(() => {
            module = loadBuiltModule(paths.dist.cerberus);
        });

        it('should have required metadata', () => {
            expect(module.id).toBe('cerberus');
            expect(module.name).toBe('Cerberus');
            expect(module.version).toMatch(/^\d+\.\d+\.\d+$/);
        });

        it('should export required functions', () => {
            expect(typeof module.searchTracks).toBe('function');
            expect(typeof module.getTrackStreamUrl).toBe('function');
            expect(typeof module.getAlbum).toBe('function');
        });

        it('should have quality settings with Tidal options', () => {
            expect(module.settings.quality).toBeDefined();
            const options = module.settings.quality.options;
            const values = options.map(o => o.value);

            expect(values).toContain('LOSSLESS');
            expect(values).toContain('HI_RES_LOSSLESS');
        });
    });
});
