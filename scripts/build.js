#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DIST_DIR = path.join(__dirname, '..', 'dist');

/**
 * Escape code for embedding in a template string.
 * - Backslashes become \\ (must be first to avoid double-escaping)
 * - Backticks become \`
 * - Template interpolations ${...} become \${...}
 */
function escapeForTemplate(code) {
    return code
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}

/**
 * Extract the export name from the @8spine-export directive.
 * Expected format: // @8spine-export EXPORT_NAME
 */
function extractExportName(code, filePath) {
    const match = code.match(/^\/\/\s*@8spine-export\s+(\w+)/m);
    if (!match) {
        throw new Error(`Missing @8spine-export directive in ${filePath}`);
    }
    return match[1];
}

/**
 * Parse @8spine-meta block comment for module metadata.
 * Expected format:
 * /* @8spine-meta
 *  * type: MODULE
 *  * category: modules
 *  * featured: false
 *  * trusted: true
 *  * nsfw: false
 *  *\/
 */
function extractMetadata(code) {
    const match = code.match(/\/\*\s*@8spine-meta\s*([\s\S]*?)\*\//);
    if (!match) return {};

    const metadata = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
        const kvMatch = line.match(/^\s*\*?\s*(\w+)\s*:\s*(.+?)\s*$/);
        if (kvMatch) {
            let value = kvMatch[2].trim();
            // Parse booleans
            if (value === 'true') value = true;
            else if (value === 'false') value = false;
            metadata[kvMatch[1]] = value;
        }
    }
    return metadata;
}

/**
 * Extract module info from the return statement.
 * Parses: id, name, version, description, labels, logo
 *
 * We look for the final return statement that contains module metadata.
 */
function extractModuleInfo(code) {
    const info = {};

    // Find the final return statement (module export)
    // Match "return {" followed by the object contents up to closing "};"
    // The return statement should be at module level (not indented deeply)
    const returnMatch = code.match(/\nreturn\s*\{([\s\S]*)\};\s*$/);
    if (!returnMatch) {
        console.warn('Could not find return statement for module info extraction');
        return info;
    }

    const returnBlock = returnMatch[1];

    // Extract string fields - look for property: 'value' or property: "value"
    // Only match simple string assignments, not function calls or expressions
    const stringFields = ['id', 'name', 'version', 'description', 'logo', 'author'];
    for (const field of stringFields) {
        // Match field: 'value' or field: "value" at the start of a line (with possible indentation)
        const regex = new RegExp(`^\\s*${field}\\s*:\\s*['"]([^'"]+)['"]`, 'm');
        const match = returnBlock.match(regex);
        if (match) {
            info[field] = match[1];
        }
    }

    // Extract labels array - look for labels: ['a', 'b', 'c']
    const labelsMatch = returnBlock.match(/^\s*labels\s*:\s*\[([^\]]+)\]/m);
    if (labelsMatch) {
        const labelsStr = labelsMatch[1];
        const labels = labelsStr.match(/['"]([^'"]+)['"]/g);
        if (labels) {
            info.labels = labels.map(l => l.replace(/['"]/g, ''));
        }
    }

    return info;
}

/**
 * Convert version string to numeric code.
 * "1.0.1" → 101, "5.0.0" → 500, "v1.2.3" → 123
 */
function versionToCode(version) {
    if (!version) return 100;
    const clean = version.replace(/^v/, '');
    const parts = clean.split('.').map(Number);
    return (parts[0] || 0) * 100 + (parts[1] || 0) * 10 + (parts[2] || 0);
}

/**
 * Generate package name from module id.
 * "music-torrent-search" → "com.8spine.module.music.torrent.search"
 */
function idToPackage(id) {
    if (!id) return 'com.8spine.module.unknown';
    return 'com.8spine.module.' + id.replace(/-/g, '.');
}

/**
 * Build module entry for module-source.json
 */
function buildModuleEntry(moduleInfo, metadata, fileName, fileSize) {
    const id = moduleInfo.id || 'unknown';
    const name = moduleInfo.name || 'Unknown Module';
    const version = moduleInfo.version || '1.0.0';
    const folder = 'dist';

    return {
        id: id,
        name: name.toUpperCase(),
        pkg: idToPackage(id),
        file: fileName,
        download: `${fileName}`,
        version: 'v' + version.replace(/^v/, ''),
        code: versionToCode(version),
        type: metadata.type || 'MODULE',
        author: moduleInfo.author || 'Unknown',
        description: (moduleInfo.description || '').toUpperCase(),
        tags: (moduleInfo.labels || []).map(l => l.toUpperCase()),
        featured: metadata.featured === true,
        trusted: metadata.trusted === true,
        nsfw: metadata.nsfw === true,
        size: fileSize,
        lang: 'all',
        folder: folder,
        sources: [{
            name: name.toUpperCase(),
            lang: 'all',
            id: id,
            baseUrl: '.'
        }]
    };
}

/**
 * Build a single module from source JS to .8spine format.
 * Returns module data for module-source.json, or null on error.
 */
function buildModule(srcPath) {
    const code = fs.readFileSync(srcPath, 'utf8');
    const exportName = extractExportName(code, srcPath);

    // Extract metadata and module info before processing
    const metadata = extractMetadata(code);
    const moduleInfo = extractModuleInfo(code);

    // Remove the directive line from output
    const cleanCode = code.replace(/^\/\/\s*@8spine-export\s+\w+\r?\n?/m, '');

    // Escape for template literal embedding
    const escapedCode = escapeForTemplate(cleanCode);

    // Wrap in template literal export
    const output = `export const ${exportName} = \`\n${escapedCode}\`;\n`;

    // Determine output path
    const baseName = path.basename(srcPath, '.js');
    const fileName = `${baseName}.8spine`;
    const destPath = path.join(DIST_DIR, fileName);

    // Ensure dist directory exists
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    fs.writeFileSync(destPath, output);
    console.log(`Built: ${path.relative(process.cwd(), srcPath)} -> ${path.relative(process.cwd(), destPath)}`);

    // Get file size
    const fileSize = fs.statSync(destPath).size;

    // Build module entry for module-source.json
    const moduleEntry = buildModuleEntry(moduleInfo, metadata, fileName, fileSize);

    return {
        destPath,
        moduleEntry,
        category: metadata.category || 'modules'
    };
}

/**
 * Build all modules in src/ directory.
 */
function buildAll() {
    if (!fs.existsSync(SRC_DIR)) {
        console.error(`Source directory not found: ${SRC_DIR}`);
        process.exit(1);
    }

    const srcFiles = fs.readdirSync(SRC_DIR)
        .filter(f => f.endsWith('.js'))
        .map(f => path.join(SRC_DIR, f));

    if (srcFiles.length === 0) {
        console.log('No .js files found in src/');
        return;
    }

    console.log(`Building ${srcFiles.length} module(s)...\n`);

    let errors = 0;
    const modulesByCategory = {};

    for (const srcFile of srcFiles) {
        try {
            const result = buildModule(srcFile);
            if (result && result.moduleEntry) {
                const categoryKey = `category:${result.category}`;
                if (!modulesByCategory[categoryKey]) {
                    modulesByCategory[categoryKey] = [];
                }
                modulesByCategory[categoryKey].push(result.moduleEntry);
            }
        } catch (err) {
            console.error(`Error building ${srcFile}: ${err.message}`);
            errors++;
        }
    }

    // Write module-source.json
    const moduleSourcePath = path.join(DIST_DIR, 'module-source.json');
    fs.writeFileSync(moduleSourcePath, JSON.stringify(modulesByCategory, null, 2));
    console.log(`\nGenerated: ${path.relative(process.cwd(), moduleSourcePath)}`);

    console.log(`\nDone. ${srcFiles.length - errors}/${srcFiles.length} modules built successfully.`);

    if (errors > 0) {
        process.exit(1);
    }
}

/**
 * Watch mode - rebuild on file changes.
 */
function watch() {
    console.log('Watching for changes in src/...\n');

    // Initial build
    buildAll();

    // Watch for changes using fs.watch
    fs.watch(SRC_DIR, { recursive: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.js')) {
            const srcPath = path.join(SRC_DIR, filename);

            // Small delay to ensure file is fully written
            setTimeout(() => {
                if (fs.existsSync(srcPath)) {
                    console.log(`\nFile changed: ${filename}`);
                    try {
                        buildModule(srcPath);
                    } catch (err) {
                        console.error(`Error: ${err.message}`);
                    }
                }
            }, 100);
        }
    });

    console.log('\nPress Ctrl+C to stop watching.');
}

/**
 * CLI entry point.
 */
function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
8spine Build Tool

Usage:
  node scripts/build.js           Build all modules in src/
  node scripts/build.js --watch   Watch mode (rebuild on changes)
  node scripts/build.js <file>    Build a specific file

Options:
  -w, --watch    Watch for changes and rebuild
  -h, --help     Show this help message
`);
        return;
    }

    if (args.includes('--watch') || args.includes('-w')) {
        watch();
        return;
    }

    // Build specific file if provided
    const fileArg = args.find(arg => !arg.startsWith('-'));
    if (fileArg) {
        const srcPath = path.resolve(fileArg);
        if (!fs.existsSync(srcPath)) {
            console.error(`File not found: ${srcPath}`);
            process.exit(1);
        }
        try {
            buildModule(srcPath);
        } catch (err) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
        return;
    }

    // Default: build all
    buildAll();
}

main();
