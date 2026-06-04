/**
 * Node module-resolution hooks so the source tree imports cleanly under
 * `node --test` with zero installed dependencies:
 *
 *   - `import 'idb'`            → tests/fixtures/fakeIdb.js (in-memory DB)
 *   - `import './x.css'`        → an empty module (Vite handles CSS in the app;
 *                                  Node cannot, and the app never reads CSS as JS)
 *
 * Registered via `--import ./tests/fixtures/register-loader.mjs`. No source edit,
 * no package.json dependency. This is the seam that lets us test SketchKit and
 * PlaybackEngine, which transitively `import './ChoicePicker.css'`.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fakeIdbUrl = pathToFileURL(resolvePath(here, 'fakeIdb.js')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'idb') {
    return { url: fakeIdbUrl, shortCircuit: true };
  }
  if (specifier.endsWith('.css')) {
    return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
