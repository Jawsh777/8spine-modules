#!/usr/bin/env tsx
/**
 * TypeScript Build Script for 8spine Modules
 *
 * Compiles TypeScript modules with npm package bundling to .8spine format.
 *
 * Usage:
 *   npm run build            # Build all modules
 *   npm run build:watch      # Watch mode
 *   npm run build -- --minify # Minified build
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { esbuild8SpinePlugin, type BuildResult } from './esbuild-plugin-8spine';

const SRC_DIR = path.resolve(__dirname, '../src');
const DIST_DIR = path.resolve(__dirname, '../dist');

interface BuildConfig {
  watch?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
}

// Directories that contain shared utilities, not modules
const EXCLUDED_DIRS = ['utils'];

/**
 * Get all source files (TypeScript and JavaScript).
 * Supports both direct files (src/qobuz.ts) and subdirectories (src/torbox/index.ts).
 */
async function getEntryPoints(): Promise<string[]> {
  const entries: string[] = [];
  const items = await fs.promises.readdir(SRC_DIR, { withFileTypes: true });

  for (const item of items) {
    if (item.isFile()) {
      // Direct file in src/
      if ((item.name.endsWith('.ts') || item.name.endsWith('.js')) && !item.name.endsWith('.d.ts')) {
        entries.push(path.join(SRC_DIR, item.name));
      }
    } else if (item.isDirectory() && !EXCLUDED_DIRS.includes(item.name)) {
      // Check for index.ts in subdirectory (excluding utility directories)
      const indexPath = path.join(SRC_DIR, item.name, 'index.ts');
      if (fs.existsSync(indexPath)) {
        entries.push(indexPath);
      }
    }
  }

  return entries;
}

/**
 * Generate module-source.json from build results.
 */
async function generateModuleSource(results: BuildResult[]): Promise<void> {
  const modulesByCategory: Record<string, unknown[]> = {};

  for (const result of results) {
    const categoryKey = `category:${result.category}`;
    if (!modulesByCategory[categoryKey]) {
      modulesByCategory[categoryKey] = [];
    }
    modulesByCategory[categoryKey].push(result.moduleEntry);
  }

  const outputPath = path.join(DIST_DIR, 'module-source.json');
  await fs.promises.writeFile(outputPath, JSON.stringify(modulesByCategory, null, 2));
  console.log(`Generated: module-source.json`);
}

/**
 * Build a single module.
 */
async function buildModule(
  entryPoint: string,
  config: BuildConfig
): Promise<BuildResult | null> {
  // For subdirectory entries (src/torbox/index.ts), use directory name as baseName
  const fileName = path.basename(entryPoint).replace(/\.(ts|js)$/, '');
  const baseName = fileName === 'index' ? path.basename(path.dirname(entryPoint)) : fileName;

  // Store build result via callback
  let buildResult: BuildResult | null = null;

  const plugin = esbuild8SpinePlugin({
    distDir: DIST_DIR,
    onBuild: (result) => {
      buildResult = result;
    },
  });

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['es2020'],
      minify: config.minify ?? false,
      sourcemap: config.sourcemap ? 'inline' : false,
      outfile: path.join(DIST_DIR, `${baseName}.js`),
      plugins: [plugin],
      treeShaking: true,
      write: false, // Let plugin handle writing
      logLevel: 'warning',
    });

    return buildResult;
  } catch (error) {
    console.error(`Error building ${baseName}:`, error);
    return null;
  }
}

/**
 * Build all modules.
 */
async function buildAll(config: BuildConfig = {}): Promise<void> {
  // Ensure dist directory exists
  await fs.promises.mkdir(DIST_DIR, { recursive: true });

  const entryPoints = await getEntryPoints();

  if (entryPoints.length === 0) {
    console.log('No source files found in src/');
    return;
  }

  console.log(`Building ${entryPoints.length} module(s)...\n`);

  const results: BuildResult[] = [];
  let errors = 0;

  for (const entry of entryPoints) {
    const result = await buildModule(entry, config);
    if (result) {
      results.push(result);
    } else {
      errors++;
    }
  }

  // Generate module-source.json
  if (results.length > 0) {
    await generateModuleSource(results);
  }

  console.log(`\nDone. ${results.length}/${entryPoints.length} modules built successfully.`);

  if (errors > 0) {
    process.exit(1);
  }
}

/**
 * Watch mode - rebuild on file changes.
 */
async function watchMode(config: BuildConfig = {}): Promise<void> {
  console.log('Starting watch mode...\n');

  // Initial build
  await buildAll(config);

  // Watch for changes
  console.log('\nWatching for changes. Press Ctrl+C to stop.\n');

  let debounceTimer: NodeJS.Timeout | null = null;

  fs.watch(SRC_DIR, { recursive: false }, (eventType, filename) => {
    if (!filename) return;
    if (!filename.endsWith('.ts') && !filename.endsWith('.js')) return;
    if (filename.endsWith('.d.ts')) return;

    // Debounce rapid file changes
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      const srcPath = path.join(SRC_DIR, filename);

      if (!fs.existsSync(srcPath)) return;

      console.log(`\nFile changed: ${filename}`);

      try {
        const result = await buildModule(srcPath, config);
        if (result) {
          // Rebuild module-source.json
          const allEntries = await getEntryPoints();
          const allResults: BuildResult[] = [];

          for (const entry of allEntries) {
            const r = await buildModule(entry, { ...config, minify: false });
            if (r) allResults.push(r);
          }

          if (allResults.length > 0) {
            await generateModuleSource(allResults);
          }
        }
      } catch (error) {
        console.error(`Error: ${error}`);
      }
    }, 100);
  });

  // Keep the process running
  process.stdin.resume();
}

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
8spine TypeScript Build Tool

Usage:
  tsx scripts/build-ts.ts           Build all modules
  tsx scripts/build-ts.ts --watch   Watch mode (rebuild on changes)
  tsx scripts/build-ts.ts --minify  Minified build

Options:
  -w, --watch     Watch for changes and rebuild
  -m, --minify    Minify output
  -s, --sourcemap Include inline source maps
  -h, --help      Show this help message
`);
    return;
  }

  const config: BuildConfig = {
    watch: args.includes('--watch') || args.includes('-w'),
    minify: args.includes('--minify') || args.includes('-m'),
    sourcemap: args.includes('--sourcemap') || args.includes('-s'),
  };

  if (config.watch) {
    await watchMode(config);
  } else {
    await buildAll(config);
    // Force exit - Babel keeps async handles open that prevent clean shutdown
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
