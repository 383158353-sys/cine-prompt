import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import http from 'node:http';
import { once } from 'node:events';
import { modelImage } from '../server/model-image.mjs';
import { upstream } from '../server/ai.mjs';
import { compressImage } from '../src/lib/compressImage.js';

test('large originals remain unchanged; model copies respect dimensions and byte budget', async () => {
  const original = await sharp({create:{width:4000,height:3000,channels:3,background:'#b87333'}}).png().toBuffer();
  const snapshot = Buffer.from(original);
  const copy = await modelImage(original, 'image/png', 300_000);
  const bytes = Buffer.from(copy.split(',')[1], 'base64');
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, 2048);
  assert.equal(metadata.height, 1536);
  assert.ok(bytes.length <= 300_000);
  assert.deepEqual(original, snapshot);
  assert.equal((await sharp(original).metadata()).width, 4000);
});

test('browser accepts a 20MB original and sends a separate bounded copy; decode errors never send original', async t => {
  const original = new File([new Uint8Array(20 * 1024 * 1024)], 'original.png', {type:'image/png'});
  const previous = {Image:globalThis.Image,document:globalThis.document};
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:test');
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  let broken = false;
  globalThis.Image = class {
    width = 4000; height = 3000;
    set src(value) { if (value) queueMicrotask(() => broken ? this.onerror() : this.onload()); }
  };
  globalThis.document = {createElement:() => ({getContext:() => ({fillRect(){},drawImage(){}}),toBlob:callback => callback(new Blob([new Uint8Array(400_000)],{type:'image/jpeg'}))})};
  t.after(() => Object.assign(globalThis, previous));
  const copy = await compressImage(original);
  assert.notEqual(copy, original);
  assert.equal(copy.type, 'image/jpeg');
  assert.equal(original.size, 20 * 1024 * 1024);
  assert.ok(copy.size <= 750_000);
  assert.equal(await compressImage(copy), copy);
  broken = true;
  await assert.rejects(compressImage(original), /无法解码/);
  assert.equal(revoked.length, 2);
});

test('upstream 413 is identified without echoing credentials and oversize JSON is not sent', async t => {
  let calls = 0;
  const mock = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls++;
    res.writeHead(413); res.end('secret-echo');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  t.after(() => new Promise(resolve => mock.close(resolve)));
  const settings = {AI_API_KEY:'test-key',AI_BASE_URL:`http://127.0.0.1:${mock.address().port}`};
  await assert.rejects(upstream('/chat/completions', {messages:[]}, settings), error => /上游 AI API.*413/.test(error.message) && !error.message.includes('secret-echo'));
  await assert.rejects(upstream('/chat/completions', {text:'图'.repeat(100)}, {...settings,AI_MAX_REQUEST_BYTES:'100'}), /发送前超过预算/);
  assert.equal(calls, 1);
});
