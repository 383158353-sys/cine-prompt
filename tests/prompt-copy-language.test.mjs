import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loadFunction(file, name) {
  const source = (await fs.readFile(new URL(file, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}\n', start) + 2;
  const context = {};
  vm.runInNewContext(source.slice(start, end) + `;this.fn = ${name};`, context);
  return context.fn;
}

test('copy variants keep each language and its negative constraints together', async () => {
  const build = await loadFunction('../src/components/PromptOutput.jsx', 'buildVariant');
  const result = build('a portrait', '一幅肖像', 'blur, noise', '模糊、噪点');
  assert.equal(result.zh, '一幅肖像\n\n负向提示词：模糊、噪点');
  assert.equal(result.en, 'a portrait\n\nNegative prompt: blur, noise');
  assert.equal(build('portrait', '肖像', 'blur', undefined).zh, '肖像');
  assert.equal(build('portrait --ar 16:9', '肖像', 'blur', '模糊').en, 'portrait --ar 16:9 --no blur');
});

test('automatic enhancement copy retains Chinese negative constraints', async () => {
  const build = await loadFunction('../src/components/PromptEnhancer.jsx', 'buildFinalPrompt');
  const result = build({ enhanced_prompt: 'a portrait', enhanced_prompt_zh: '一幅肖像', negative_prompt: 'blur', negative_prompt_zh: '模糊' });
  assert.equal(result.zh, '一幅肖像\n\n负向提示词：模糊');
  assert.equal(result.en, 'a portrait\n\nNegative prompt: blur');
});

test('automatic requests reach the server default while explicit model choices remain intact', async () => {
  const source = (await fs.readFile(new URL('../src/api/base44Client.js', import.meta.url), 'utf8'))
    .replace(/^import .*\r?\n/, '').replace('export const base44 =', 'globalThis.base44 =');
  const calls = [];
  const context = { compressImage: async f => f, fetch: async (_url, options) => {
    calls.push(JSON.parse(options.body)); return { ok: true, text: async () => '{}' };
  } };
  vm.runInNewContext(source, context);
  await context.base44.functions.invoke('enhancePrompt', { model: 'automatic' });
  await context.base44.functions.invoke('enhancePrompt', { model: 'hk-5-5' });
  assert.equal(calls[0].data.model, 'automatic');
  assert.equal(calls[1].data.model, 'hk-5-5');
});
