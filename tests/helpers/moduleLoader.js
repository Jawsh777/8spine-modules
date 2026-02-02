const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

/**
 * Load a built .8spine module and return the module object.
 * @param {string} modulePath - Path to the .8spine file
 * @returns {Object} The module's exported object
 */
function loadBuiltModule(modulePath) {
    const content = fs.readFileSync(modulePath, 'utf8');

    // Extract code from template string export
    const match = content.match(/export const \w+ = `([\s\S]+)`;?\s*$/);
    if (!match) {
        throw new Error(`Could not parse module format in ${modulePath}`);
    }

    // Unescape the template string
    const code = match[1]
        .replace(/\\`/g, '`')
        .replace(/\\\$/g, '$')
        .replace(/\\\\/g, '\\');

    // Evaluate and return module object
    const moduleFactory = new Function(code);
    return moduleFactory();
}

/**
 * Load a source .js or .ts module directly (before build).
 * Bundles the module with its imports, then evaluates.
 * @param {string} srcPath - Path to the source .js or .ts file
 * @returns {Object} The module's exported object
 */
function loadSourceModule(srcPath) {
    // Bundle and transform TypeScript (handles imports)
    const code = bundleTypeScript(srcPath);

    // Evaluate and return module object
    const moduleFactory = new Function(code);
    return moduleFactory();
}

/**
 * Bundle and strip TypeScript-specific syntax to make code evaluable in plain JS.
 * Uses esbuild for reliable TypeScript transformation and bundling.
 * @param {string} srcPath - Path to the TypeScript source file
 * @returns {string} JavaScript code with all imports bundled
 */
function bundleTypeScript(srcPath) {
    // Use esbuild to bundle and transform TypeScript
    const result = esbuild.buildSync({
        entryPoints: [srcPath],
        bundle: true,
        write: false,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
    });

    let jsCode = result.outputFiles[0].text;

    // Remove "use strict" if present
    jsCode = jsCode.replace(/^"use strict";\s*/m, '');

    // esbuild output ends with pattern like:
    // var module = {...};
    // var torbox_default = module;
    // export {
    //   torbox_default as default
    // };
    //
    // We need to convert to: return module;

    // Step 1: Remove the export statement
    jsCode = jsCode.replace(/export\s*\{\s*[\w_]+\s+as\s+default\s*\};\s*$/m, '');

    // Step 2: Find the default alias and what it points to
    // Pattern: var xyz_default = something;
    const aliasMatch = jsCode.match(/var\s+(\w+_default)\s*=\s*(\w+);\s*$/);
    if (aliasMatch) {
        const moduleVarName = aliasMatch[2]; // e.g., "module"
        // Remove the alias declaration
        jsCode = jsCode.replace(/var\s+\w+_default\s*=\s*\w+;\s*$/, '');
        // Add return statement
        jsCode = jsCode.trimEnd() + `\nreturn ${moduleVarName};`;
    } else {
        // Fallback: just return the last variable assignment that looks like a module
        // This handles simpler cases
        const lastVarMatch = jsCode.match(/var\s+(\w+)\s*=\s*\{[\s\S]*?\};\s*$/);
        if (lastVarMatch) {
            jsCode = jsCode.trimEnd() + `\nreturn ${lastVarMatch[1]};`;
        }
    }

    return jsCode;
}

/**
 * Strip TypeScript-specific syntax to make code evaluable in plain JS.
 * Uses esbuild for reliable TypeScript transformation.
 * NOTE: This doesn't handle imports - use bundleTypeScript for files with imports.
 * @param {string} code - TypeScript source code
 * @returns {string} JavaScript code
 */
function stripTypeScript(code) {
    // Use esbuild to properly strip TypeScript syntax
    const result = esbuild.transformSync(code, {
        loader: 'ts',
        format: 'esm',
        target: 'es2020',
    });

    let jsCode = result.code;

    // Remove import statements (they import types that don't exist at runtime)
    jsCode = jsCode.replace(/^import\s+.*?from\s+["'][^"']+["'];\s*$/gm, '');

    // Remove the ESM export wrapper at the end
    // Pattern: var stdin_default = module;\nexport {\n  stdin_default as default\n};
    jsCode = jsCode.replace(/var stdin_default = (\w+);\s*export\s*\{[\s\S]*\};\s*$/, 'return $1;');

    return jsCode;
}

/**
 * Extract individual functions from source code for unit testing.
 * Returns an object with the functions that can be called.
 * @param {string} srcPath - Path to the source .js or .ts file
 * @param {string[]} functionNames - Names of functions to extract
 * @returns {Object} Object containing the extracted functions
 */
function extractFunctions(srcPath, functionNames) {
    // Bundle and transform TypeScript (handles imports)
    let code = bundleTypeScript(srcPath);

    // After bundling, code ends with "return module;" or similar
    // Replace that final return with one that exports only the requested functions
    const returnStatement = `return { ${functionNames.join(', ')} };`;
    const modifiedCode = code.replace(/return\s+\w+;\s*$/, returnStatement);

    const factory = new Function(modifiedCode);
    return factory();
}

/**
 * Get paths to all modules
 */
function getModulePaths() {
    const root = path.resolve(__dirname, '../..');
    return {
        src: {
            torbox: path.join(root, 'src/torbox.ts'),
            qobuz: path.join(root, 'src/qobuz.ts'),
            cerberus: path.join(root, 'src/cerberus.ts'),
        },
        dist: {
            torbox: path.join(root, 'dist/torbox.8spine'),
            qobuz: path.join(root, 'dist/qobuz.8spine'),
            cerberus: path.join(root, 'dist/cerberus.8spine'),
        }
    };
}

module.exports = {
    loadBuiltModule,
    loadSourceModule,
    extractFunctions,
    getModulePaths,
};
