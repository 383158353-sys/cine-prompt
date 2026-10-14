import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('color palettes use the same local entity facade as the other libraries', async () => {
  const source = (await fs.readFile(new URL('../src/api/base44Client.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/, '')
    .replace('export const base44 =', 'globalThis.base44 =');
  const calls = [];
  const context = {
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, text: async () => '[]' };
    },
    compressImage: async file => file
  };
  vm.runInNewContext(source, context);
  const rows = await context.base44.entities.ColorPalette.filter({ scope: 'character' }, '-updated_date', 200);
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 0);
  assert.equal(calls[0].url, '/api/local/rpc');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), {
    kind: 'entity', name: 'ColorPalette', action: 'filter', args: [{ scope: 'character' }, '-updated_date', 200]
  });
});
