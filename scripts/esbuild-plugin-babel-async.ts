/**
 * Transform async generators in bundled code using Babel.
 *
 * This is needed because esbuild doesn't transform async generators,
 * and JavaScriptCore (iOS) doesn't support them.
 */

import * as babel from '@babel/core';

/**
 * Post-process bundled code to transform async generators.
 * Call this on the bundled output before wrapping as .8spine
 */
export async function transformAsyncGenerators(code: string): Promise<string> {
  // Skip if no async generators present
  if (!code.includes('for await') && !code.includes('async') || !code.includes('function*')) {
    return code;
  }

  const result = await babel.transformAsync(code, {
    filename: 'bundle.js',
    presets: [
      ['@babel/preset-env', {
        targets: { ios: '12' },
        modules: false,
        include: [
          'transform-async-generator-functions',
          'transform-async-to-generator',
        ]
      }]
    ],
    parserOpts: {
      allowReturnOutsideFunction: true,
    },
    sourceMaps: false,
    babelrc: false,
    configFile: false,
  });

  return result?.code || code;
}
