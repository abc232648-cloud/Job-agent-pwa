import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const expected = {"format_version":1,"app":"jobs","release_set":"chief-install-closure-2026-10-14","backend_contract":"chief-install-closure-v1","route":"/jobs/"};

test('PWA declares the pinned Chief release contract', async () => {
  const value = JSON.parse(await readFile(new URL('../public/release.json', import.meta.url), 'utf8'));
  assert.deepEqual(value, expected);
});
