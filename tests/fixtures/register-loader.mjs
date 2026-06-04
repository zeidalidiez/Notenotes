/**
 * Registers the module-resolution hooks (loader.mjs) AND installs the browser
 * global shims that some source modules expect to exist. Loaded once per test
 * process via `node --import ./tests/fixtures/register-loader.mjs`, before any
 * source module is imported.
 *
 * Globals are installed here (not in a per-test helper) because a handful of
 * modules read them at module-evaluation time, which happens during `import`.
 */

import { register } from 'node:module';

register('./loader.mjs', import.meta.url);

import './globals.js';
