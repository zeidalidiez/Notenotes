import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const size of [192, 512]) {
  test(`PWA ${size}px icon exists and has the advertised dimensions`, async () => {
    const bytes = await readFile(new URL(`../../public/icons/icon-${size}.png`, import.meta.url));
    assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  });
}
