import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDatabase, changedRows } from '../shared/web-database.mjs';
import { relocateFunction } from '../scripts/compile-functions.mjs';
import { restoreApiUrl } from '../shared/request-url.mjs';
import { withMemoryDatabase, entity } from '../server/local-client.mjs';
import { withSettings, currentConfig, upstream } from '../server/ai.mjs';

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
