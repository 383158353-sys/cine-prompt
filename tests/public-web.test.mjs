import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectDatabase, changedRows } from '../shared/web-database.mjs';
import { relocateFunction } from '../scripts/compile-functions.mjs';
import { restoreApiUrl } from '../shared/request-url.mjs';
import { withMemoryDatabase, entity } from '../server/local-client.mjs';
import { withSettings, currentConfig, upstream } from '../server/ai.mjs';
import { mergeEntityRows, openBrowserDatabase, planPublicDatabaseOpen } from '../src/lib/publicWeb.js';

function createMemoryIndexedDB(initial) {
  const databases = new Map();
  if (initial) databases.set(initial.name, { version: initial.version, stores: new Set(initial.stores) });
  const requested = [];
  return {
    requested,
    open(name, version) {
      requested.push(version === undefined ? null : version);
      const request = {};
      queueMicrotask(() => {
        let record = databases.get(name);
        if (record && version != null && version < record.version) {
          request.error = Object.assign(
            new Error(`The requested version (${version}) is less than the existing version (${record.version}).`),
            { name: 'VersionError' }
          );
          request.onerror?.();
          return;
        }
        const creating = !record;
        if (creating) {
          record = { version: version == null ? 1 : version, stores: new Set() };
          databases.set(name, record);
        }
        const upgrading = version != null && version > record.version;
        if (upgrading) record.version = version;
        request.result = {
          get version() { return record.version; },
          objectStoreNames: { contains: (store) => record.stores.has(store) },
          createObjectStore(store) { record.stores.add(store); },
          close() { this.closed = true; },
          closed: false
        };
        if (creating || upgrading) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

function openResult(factory, name, version) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test('web database projection drops image payloads and keeps prompt examples', () => {
  const projected = projectDatabase({
    Prompt: [
      { id: 'p1', direction: 'character_realistic', rating: 5, raw_input: '输入', content: '输出', thumbnail_url: 'data:image/png;base64,' + 'a'.repeat(8000) },
      { id: 'p2', rating: 3, raw_input: 'skip-low', content: 'still-text' }
    ],
    StyleLibrary: [{ id: 's1', name: '胶片', category: 'overall', style_prompt: 'film', thumbnail_url: 'data:image/jpeg;base64,AAAA' }],
    Direction: [],
    ColorPalette: []
  });
  assert.equal(projected.Prompt[0].raw_input, '输入');
  assert.equal(projected.Prompt[0].thumbnail_url, undefined);
  assert.equal(projected.StyleLibrary[0].thumbnail_url, 'inline');
  assert.ok(JSON.stringify(projected).length < 2000);
});

test('changed rows report only records the function updated', () => {
  const before = { StyleLibrary: [{ id: 's1', thumbnail_url: '' }] };
  const after = { StyleLibrary: [{ id: 's1', thumbnail_url: 'https://example.test/a.png' }] };
  assert.deepEqual(changedRows(before, after), [{ name: 'StyleLibrary', row: after.StyleLibrary[0] }]);
});

test('request settings do not remain on the desktop config', async () => {
  assert.notEqual(currentConfig().AI_API_KEY, 'web-user-secret');
  await withSettings({ AI_API_KEY: 'web-user-secret', AI_MODEL: 'web-model' }, async () => {
    assert.equal(currentConfig().AI_API_KEY, 'web-user-secret');
  });
  assert.notEqual(currentConfig().AI_API_KEY, 'web-user-secret');
});

test('public web refuses private and non-https API addresses', async () => {
  process.env.CINE_PUBLIC_WEB = '1';
  const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
  const settings = { AI_PROVIDER: 'compatible', AI_API_KEY: 'k', AI_MODEL: 'm', AI_BASE_URL: 'http://127.0.0.1:9/v1' };
  await assert.rejects(() => upstream('/chat/completions', body, settings), /HTTPS/);
  await assert.rejects(() => upstream('/chat/completions', body, { ...settings, AI_BASE_URL: 'https://127.0.0.1/v1' }), /内网|本机/);
  await assert.rejects(() => upstream('/chat/completions', body, { ...settings, AI_BASE_URL: 'https://169.254.169.254/v1' }), /内网|本机/);
  delete process.env.CINE_PUBLIC_WEB;
});

test('memory database writes stay off disk', async () => {
  const db = { Prompt: [] };
  const row = await withMemoryDatabase(db, () => entity('Prompt').create({ title: '网页', content: '只在这次请求里' }));
  assert.equal(row.title, '网页');
  assert.equal(db.Prompt.length, 1);
  assert.equal(db.Prompt[0].id, row.id);
});

test('public api rewrite keeps the original path and query', () => {
  assert.equal(restoreApiUrl('/api/handler?cinepath=/local/rpc'), '/api/local/rpc');
  assert.equal(restoreApiUrl('/api/handler?cinepath=/local/voice/status&id=abc&cursor=2'), '/api/local/voice/status?id=abc&cursor=2');
  assert.equal(restoreApiUrl('/api/local/rpc'), '/api/local/rpc');
  assert.equal(restoreApiUrl('/api/handler?cinepath=../server/index.mjs'), '/api/handler?cinepath=../server/index.mjs');
});

test('public web database open never requests a version below an existing v3 database', async () => {
  const legacyStores = ['Prompt', 'Direction', 'StyleLibrary', 'ColorPalette', 'DirectionReferenceImage'];
  const factory = createMemoryIndexedDB({ name: 'cine-prompt-private', version: 3, stores: legacyStores });
  const db = await openBrowserDatabase(factory);
  assert.equal(db.version, 4);
  assert.equal(db.closed, false);
  assert.equal(db.objectStoreNames.contains('rows'), true);
  for (const store of legacyStores) assert.equal(db.objectStoreNames.contains(store), true);
  assert.deepEqual(factory.requested, [null, 4]);
  await assert.rejects(
    () => openResult(factory, 'cine-prompt-private', 1),
    /The requested version \(1\) is less than the existing version \(4\)/
  );
});

test('an existing rows store opens in place and a new database only creates rows', async () => {
  const existing = createMemoryIndexedDB({ name: 'cine-prompt-private', version: 1, stores: ['rows'] });
  const opened = await openBrowserDatabase(existing);
  assert.equal(opened.version, 1);
  assert.deepEqual(existing.requested, [null]);

  const created = createMemoryIndexedDB();
  const fresh = await openBrowserDatabase(created);
  assert.equal(fresh.version, 1);
  assert.equal(fresh.objectStoreNames.contains('rows'), true);
  assert.equal(fresh.objectStoreNames.contains('Prompt'), false);
  assert.deepEqual(created.requested, [null]);
});

test('version plan upgrades only when the rows store is missing', () => {
  assert.deepEqual(planPublicDatabaseOpen(3, true), { requestedVersion: null });
  assert.deepEqual(planPublicDatabaseOpen(3, false), { requestedVersion: 4 });
  assert.deepEqual(planPublicDatabaseOpen(1, true), { requestedVersion: null });
  assert.deepEqual(planPublicDatabaseOpen(null, false), { requestedVersion: 1 });
  assert.ok(planPublicDatabaseOpen(8, false).requestedVersion > 8);
  const source = readFileSync(new URL('../src/lib/publicWeb.js', import.meta.url), 'utf8');
  assert.equal(source.includes('indexedDB.open(DB_NAME, 1)'), false);
});

test('legacy entity rows stay readable and a newer copy wins', () => {
  assert.deepEqual(mergeEntityRows(
    [{ id: 'p1', content: 'old' }, { id: 'p2', content: 'kept' }],
    [{ id: 'p1', content: 'new' }]
  ), [
    { id: 'p1', content: 'new' },
    { id: 'p2', content: 'kept' }
  ]);
});

test('packaged function imports resolve beside the server entry', () => {
  const source = "import { createClientFromRequest } from './local-client.mjs';\nimport { buildProjectStyleInstruction } from '../shared/project-styles.mjs';\nexport { parseStoryboard as default } from './spreadsheet.mjs';\n";
  const relocated = relocateFunction(source);
  assert.match(relocated, /from '\.\.\/local-client\.mjs'/);
  assert.match(relocated, /from '\.\.\/\.\.\/shared\/project-styles\.mjs'/);
  assert.match(relocated, /from '\.\.\/spreadsheet\.mjs'/);
  const compiled = 'import { createClientFromRequest } from "./local-client.mjs";\nimport { buildProjectStyleInstruction } from "../shared/project-styles.mjs";\nexport { parseStoryboard as default } from "./spreadsheet.mjs";\n';
  const relocatedCompiled = relocateFunction(compiled);
  assert.match(relocatedCompiled, /from "\.\.\/local-client\.mjs"/);
  assert.match(relocatedCompiled, /from "\.\.\/\.\.\/shared\/project-styles\.mjs"/);
  assert.match(relocatedCompiled, /from "\.\.\/spreadsheet\.mjs"/);
});
