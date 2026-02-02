/**
 * esbuild plugin for 8spine module format
 *
 * Transforms bundled JavaScript into the .8spine template string export format.
 */

import type { Plugin } from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Escape code for embedding in a JavaScript template string.
 * - Backslashes become \\ (must be first to avoid double-escaping)
 * - Backticks become \`
 * - Template interpolations ${...} become \${...}
 */
function escapeForTemplate(code: string): string {
  return code
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Extract the export name from the @8spine-export directive.
 * If not found, generates one from the filename.
 */
function extractExportName(code: string, filePath: string): string {
  const match = code.match(/\/\/\s*@8spine-export\s+(\w+)/);
  if (match) {
    return match[1];
  }
  // Generate from filename: qobuz.ts -> QOBUZ_MODULE_CODE
  const baseName = path.basename(filePath, path.extname(filePath));
  return baseName.toUpperCase().replace(/-/g, '_') + '_MODULE_CODE';
}

/**
 * Parse @8spine-meta block comment for module metadata.
 */
function extractMetadata(code: string): Record<string, unknown> {
  const match = code.match(/\/\*\s*@8spine-meta\s*([\s\S]*?)\*\//);
  if (!match) return {};

  const metadata: Record<string, unknown> = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const kvMatch = line.match(/^\s*\*?\s*(\w+)\s*:\s*(.+?)\s*$/);
    if (kvMatch) {
      let value: unknown = kvMatch[2].trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      metadata[kvMatch[1]] = value;
    }
  }

  return metadata;
}

/**
 * Extract module info from the return statement or export default.
 * Parses: id, name, version, description, labels, logo, author
 */
function extractModuleInfo(code: string): Record<string, unknown> {
  const info: Record<string, unknown> = {};

  // Try pattern 1: return { ... } or export default { ... }
  let returnMatch = code.match(/(?:return|export\s+default)\s*\{([\s\S]*)\};\s*$/);

  // Try pattern 2: const module = { ... }; export default module;
  // Handles TypeScript: const module: Module8Spine = { ... };
  if (!returnMatch) {
    const moduleVarMatch = code.match(
      /const\s+module\s*(?::\s*[\w<>]+)?\s*=\s*\{([\s\S]*?)\};\s*export\s+default\s+module;?\s*$/
    );
    if (moduleVarMatch) {
      returnMatch = ['', moduleVarMatch[1]];
    }
  }

  if (!returnMatch) {
    return info;
  }

  const returnBlock = returnMatch[1];

  // Extract string fields
  const stringFields = ['id', 'name', 'version', 'description', 'logo', 'author'];
  for (const field of stringFields) {
    const regex = new RegExp(`^\\s*${field}\\s*:\\s*['"]([^'"]+)['"]`, 'm');
    const match = returnBlock.match(regex);
    if (match) {
      info[field] = match[1];
    }
  }

  // Extract labels array
  const labelsMatch = returnBlock.match(/^\s*labels\s*:\s*\[([^\]]+)\]/m);
  if (labelsMatch) {
    const labelsStr = labelsMatch[1];
    const labels = labelsStr.match(/['"]([^'"]+)['"]/g);
    if (labels) {
      info.labels = labels.map((l) => l.replace(/['"]/g, ''));
    }
  }

  return info;
}

/**
 * Convert version string to numeric code.
 * "1.0.1" → 101, "5.0.0" → 500, "v1.2.3" → 123
 */
function versionToCode(version: string | undefined): number {
  if (!version) return 100;
  const clean = version.replace(/^v/, '');
  const parts = clean.split('.').map(Number);
  return (parts[0] || 0) * 100 + (parts[1] || 0) * 10 + (parts[2] || 0);
}

/**
 * Generate package name from module id.
 * "music-torrent-search" → "com.8spine.module.music.torrent.search"
 */
function idToPackage(id: string | undefined): string {
  if (!id) return 'com.8spine.module.unknown';
  return 'com.8spine.module.' + id.replace(/-/g, '.');
}

export interface ModuleEntry {
  id: string;
  name: string;
  pkg: string;
  file: string;
  download: string;
  version: string;
  code: number;
  type: string;
  author: string;
  description: string;
  tags: string[];
  featured: boolean;
  trusted: boolean;
  nsfw: boolean;
  size: number;
  lang: string;
  folder: string;
  sources: Array<{
    name: string;
    lang: string;
    id: string;
    baseUrl: string;
  }>;
}

export interface BuildResult {
  outputPath: string;
  moduleEntry: ModuleEntry;
  category: string;
}

/**
 * Build module entry for module-source.json
 */
function buildModuleEntry(
  moduleInfo: Record<string, unknown>,
  metadata: Record<string, unknown>,
  fileName: string,
  fileSize: number
): ModuleEntry {
  const id = (moduleInfo.id as string) || 'unknown';
  const name = (moduleInfo.name as string) || 'Unknown Module';
  const version = (moduleInfo.version as string) || '1.0.0';

  return {
    id,
    name: name.toUpperCase(),
    pkg: idToPackage(id),
    file: fileName,
    download: fileName,
    version: 'v' + version.replace(/^v/, ''),
    code: versionToCode(version),
    type: (metadata.type as string) || 'MODULE',
    author: (moduleInfo.author as string) || 'Unknown',
    description: ((moduleInfo.description as string) || '').toUpperCase(),
    tags: ((moduleInfo.labels as string[]) || []).map((l) => l.toUpperCase()),
    featured: metadata.featured === true,
    trusted: metadata.trusted === true,
    nsfw: metadata.nsfw === true,
    size: fileSize,
    lang: 'all',
    folder: 'dist',
    sources: [
      {
        name: name.toUpperCase(),
        lang: 'all',
        id,
        baseUrl: '.',
      },
    ],
  };
}

export interface PluginOptions {
  /** Directory containing source files */
  srcDir: string;
  /** Output directory */
  distDir: string;
  /** Callback to receive build results */
  onBuild?: (result: BuildResult) => void;
}

/**
 * Transform esbuild's bundled output into clean 8spine module code.
 *
 * esbuild outputs an IIFE with CommonJS helpers. We need to:
 * 1. Extract the actual module code
 * 2. Convert export default to return statement
 */
function transformBundledCode(code: string): string {
  // For ESM format, the output looks like:
  // var module2 = { ... };
  // export { module2 as default };
  //
  // Or with bundled code:
  // "use strict";
  // var ... helpers ...
  // var qobuz_exports = {};
  // __export(qobuz_exports, { default: () => qobuz_default });
  // ... code ...
  // var module2 = { ... };
  // var qobuz_default = module2;
  // export { qobuz_default as default };

  let result = code;

  // Remove "use strict";
  result = result.replace(/^"use strict";\s*/m, '');

  // For simple cases where there's just a module variable and export
  // Pattern: var module2 = { ... }; ... export { module2 as default };
  const simpleMatch = result.match(/var\s+(\w+)\s*=\s*(\{[\s\S]*?\});\s*(?:var\s+\w+\s*=\s*\1;\s*)?export\s*\{[^}]*\};\s*$/);
  if (simpleMatch) {
    // Replace the export with a return
    result = result.replace(/var\s+(\w+)\s*=\s*(\1);\s*export\s*\{[^}]*\};\s*$/, '');
    result = result.replace(/export\s*\{[^}]*\};\s*$/, '');
    result = result.replace(/var\s+(\w+)\s*=\s*(\{[\s\S]*?\});(\s*)$/, 'return $2;$3');
  }

  // Handle the pattern where module is assigned and then exported
  // var module2 = { ... };
  // var xyz_default = module2;
  // export { xyz_default as default };
  const aliasMatch = result.match(/var\s+(\w+)\s*=\s*(\{[\s\S]*?\});\s*var\s+(\w+)\s*=\s*\1;\s*export\s*\{[^}]*\};\s*$/);
  if (aliasMatch) {
    const moduleVar = aliasMatch[1];
    const moduleObj = aliasMatch[2];
    // Replace the whole ending with just return
    result = result.replace(
      new RegExp(`var\\s+${moduleVar}\\s*=\\s*\\{[\\s\\S]*?\\};\\s*var\\s+\\w+\\s*=\\s*${moduleVar};\\s*export\\s*\\{[^}]*\\};\\s*$`),
      `return ${moduleObj};`
    );
  }

  // Remove any remaining export statements
  result = result.replace(/export\s*\{[^}]*\};\s*$/gm, '');

  // If there's still no return statement at the end, try to find the module object
  if (!/return\s*\{[\s\S]*\};\s*$/.test(result)) {
    // Look for: var xyz_default = module2; at the end and convert
    const defaultVarMatch = result.match(/var\s+(\w+_default)\s*=\s*(\w+);\s*$/);
    if (defaultVarMatch) {
      const moduleVar = defaultVarMatch[2];
      // Find the module definition
      const moduleDefMatch = result.match(new RegExp(`var\\s+${moduleVar}\\s*=\\s*(\\{[\\s\\S]*?\\});`));
      if (moduleDefMatch) {
        // Remove the default variable assignment
        result = result.replace(/var\s+\w+_default\s*=\s*\w+;\s*$/, '');
        // Change the module variable to return
        result = result.replace(
          new RegExp(`var\\s+${moduleVar}\\s*=\\s*(\\{[\\s\\S]*?\\});`),
          `return $1;`
        );
      }
    }
  }

  // Handle minified output where variable names are mangled
  // Pattern: var H={id:"...",name:"...",...},_=H; (comma-separated)
  // Or: var H={id:"...",name:"...",...};var _=H; (semicolon-separated)
  // Check for return at END of code (not inside functions)
  const hasReturnAtEnd = /return\s*\{[\s\S]*\};\s*$/.test(result) || /return\s+\w+;\s*$/.test(result);
  if (!hasReturnAtEnd) {
    // Match trailing alias: ,_=H; or ;var _=H; or just ,_=H at end
    const trailingAliasMatch = result.match(/[,;]\s*(?:var\s+)?(\w+)\s*=\s*(\w+)\s*;?\s*$/);
    if (trailingAliasMatch) {
      const moduleVar = trailingAliasMatch[2];

      // Find where this module variable is defined: ,H={ or var H={
      const defPattern = new RegExp(`(?:var\\s+|,\\s*)${moduleVar}\\s*=\\s*\\{`);
      const defMatch = result.match(defPattern);

      if (defMatch && defMatch.index !== undefined) {
        const objStartIdx = defMatch.index + defMatch[0].length - 1; // Position of opening {

        // Find matching closing brace using bracket counting
        let depth = 1;
        let i = objStartIdx + 1;
        while (depth > 0 && i < result.length) {
          const char = result[i];
          if (char === '{') depth++;
          else if (char === '}') depth--;
          i++;
        }
        const objEndIdx = i;

        const moduleObj = result.substring(objStartIdx, objEndIdx);

        // Only proceed if this looks like a module object (has id:)
        if (moduleObj.includes('id:')) {
          const before = result.substring(0, defMatch.index);
          // Clean up: if before ends with comma, replace with semicolon
          const cleanBefore = before.replace(/,\s*$/, ';');

          result = (cleanBefore || '') + 'return ' + moduleObj + ';';
        }
      }
    }
  }

  return result.trim();
}

/**
 * esbuild plugin that transforms bundled output to .8spine format.
 *
 * This plugin:
 * 1. Reads original source to extract @8spine-export directive
 * 2. After bundling, wraps the output in a template string export
 * 3. Writes the result as a .8spine file
 */
export function esbuild8SpinePlugin(options: PluginOptions): Plugin {
  const { srcDir, distDir, onBuild } = options;

  // Cache for source file contents (to extract directives)
  const sourceCache = new Map<string, string>();

  return {
    name: '8spine-format',
    setup(build) {
      // Intercept TypeScript/JavaScript files to cache their source
      build.onLoad({ filter: /\.(ts|js)$/ }, async (args) => {
        // Only cache files from src directory
        if (args.path.includes(srcDir) || args.path.includes('/src/')) {
          const source = await fs.promises.readFile(args.path, 'utf8');
          sourceCache.set(args.path, source);
        }
        // Return undefined to let esbuild handle the actual loading
        return undefined;
      });

      // Transform the output after bundling
      build.onEnd(async (result) => {
        if (!result.outputFiles) return;

        for (const file of result.outputFiles) {
          if (!file.path.endsWith('.js')) continue;

          // Find the corresponding source file
          const baseName = path.basename(file.path, '.js');
          let sourceContent = '';
          let sourcePath = '';

          for (const [cachedPath, content] of sourceCache.entries()) {
            const cachedBase = path.basename(cachedPath).replace(/\.(ts|js)$/, '');
            if (cachedBase === baseName) {
              sourceContent = content;
              sourcePath = cachedPath;
              break;
            }
          }

          // Extract export name from original source
          const exportName = extractExportName(sourceContent, sourcePath || file.path);

          // Extract metadata for module-source.json
          const metadata = extractMetadata(sourceContent);
          const moduleInfo = extractModuleInfo(sourceContent);

          // Get the bundled code and transform it
          let code = transformBundledCode(file.text);

          // Escape for template literal
          const escapedCode = escapeForTemplate(code);

          // Wrap in template string export
          const output = `export const ${exportName} = \`\n${escapedCode}\`;\n`;

          // Write .8spine file
          const outputPath = path.join(distDir, `${baseName}.8spine`);
          await fs.promises.writeFile(outputPath, output);

          // Get file size
          const stats = await fs.promises.stat(outputPath);

          // Build module entry for module-source.json
          const moduleEntry = buildModuleEntry(
            moduleInfo,
            metadata,
            `${baseName}.8spine`,
            stats.size
          );

          const buildResult: BuildResult = {
            outputPath,
            moduleEntry,
            category: (metadata.category as string) || 'modules',
          };

          // Notify via callback
          if (onBuild) {
            onBuild(buildResult);
          }

          console.log(`Built: ${baseName}.8spine`);
        }
      });
    },
  };
}
