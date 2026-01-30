const fs = require('fs');
const path = require('path');

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
 * Load a source .js module directly (before build).
 * Removes the @8spine-export directive and evaluates.
 * @param {string} srcPath - Path to the source .js file
 * @returns {Object} The module's exported object
 */
function loadSourceModule(srcPath) {
    let code = fs.readFileSync(srcPath, 'utf8');

    // Remove the @8spine-export directive
    code = code.replace(/^\/\/\s*@8spine-export\s+\w+\r?\n?/m, '');

    // Evaluate and return module object
    const moduleFactory = new Function(code);
    return moduleFactory();
}

/**
 * Extract individual functions from source code for unit testing.
 * Returns an object with the functions that can be called.
 * @param {string} srcPath - Path to the source .js file
 * @param {string[]} functionNames - Names of functions to extract
 * @returns {Object} Object containing the extracted functions
 */
function extractFunctions(srcPath, functionNames) {
    let code = fs.readFileSync(srcPath, 'utf8');

    // Remove the @8spine-export directive
    code = code.replace(/^\/\/\s*@8spine-export\s+\w+\r?\n?/m, '');

    // Find the last return statement and replace it
    // This handles multi-line return statements with proper brace matching
    const lastReturnIndex = code.lastIndexOf('return {');
    if (lastReturnIndex === -1) {
        throw new Error(`Could not find return statement in ${srcPath}`);
    }

    // Find matching closing brace by counting braces
    let braceCount = 0;
    let endIndex = lastReturnIndex;
    let foundOpen = false;

    for (let i = lastReturnIndex; i < code.length; i++) {
        if (code[i] === '{') {
            braceCount++;
            foundOpen = true;
        } else if (code[i] === '}') {
            braceCount--;
            if (foundOpen && braceCount === 0) {
                endIndex = i + 1;
                break;
            }
        }
    }

    // Replace the return statement with our custom one
    const returnStatement = `return { ${functionNames.join(', ')} };`;
    const modifiedCode = code.substring(0, lastReturnIndex) + returnStatement;

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
            torbox: path.join(root, 'src/torbox.js'),
            qobuz: path.join(root, 'src/qobuz.js'),
            kinoplus: path.join(root, 'src/kinoplus.js'),
        },
        dist: {
            torbox: path.join(root, 'dist/torbox.8spine'),
            qobuz: path.join(root, 'dist/qobuz.8spine'),
            kinoplus: path.join(root, 'dist/kinoplus.8spine'),
        }
    };
}

module.exports = {
    loadBuiltModule,
    loadSourceModule,
    extractFunctions,
    getModulePaths,
};
