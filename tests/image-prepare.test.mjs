import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import sharp from 'sharp';
import {
  PLATFORM_DECODED_LIMIT,
  SAFE_DECODED_LIMIT,
  prepareGeneratePayload,
  prepareSubmissionImage,
  prepareSubmissionImages,
  sniffMime
} from '../desktop/helper/image-prepare.cjs';

const require = createRequire(import.meta.url);
const { createVoiceServer } = require('../desktop/helper/voice-server.cjs');

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function decodeDataUrl(value) {
  const match = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  assert.ok(match, 'prepared value is not an image data URL');
  return Buffer.from(match[1], 'base64');
}

function pngOfSize(base, size) {
  const extra = size - base.length;
  assert.ok(extra >= 12, 'base image is already past the requested size');
  const iend = base.lastIndexOf(Buffer.from('IEND'));
  const start = iend - 4;
  const text = Buffer.alloc(extra - 12, 0x58);
  const type = Buffer.from('tEXt');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(text.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, text])) >>> 0);
  return Buffer.concat([base.subarray(0, start), length, type, text, crc, base.subarray(start)]);
}

function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = { write() {} };
  child.kill = () => {};
  child.exitCode = null;
  return child;
}

async function rawImage({ width, height, channels, fill, compressionLevel = 0 }) {
  const raw = Buffer.alloc(width * height * channels);
  for (let i = 0; i < raw.length; i += channels) fill(raw, i, i / channels, width);
  return sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel }).toBuffer();
}

test('an under-limit original, including transparency, is returned unchanged', async () => {
  const bytes = await sharp({
    create: { width: 32, height: 24, channels: 4, background: { r: 20, g: 90, b: 140, alpha: 0.35 } }
  }).png().toBuffer();
  const snapshot = Buffer.from(bytes);
  const original = dataUrl('image/png', bytes);
  assert.equal(await prepareSubmissionImage(original), original);
  assert.deepEqual(bytes, snapshot);
  const wrapped = { name: '选区.png', data: original };
  assert.equal(await prepareSubmissionImage(wrapped), wrapped);
  assert.equal(await prepareSubmissionImage('https://example.test/original.png'), 'https://example.test/original.png');
});

test('a mislabeled under-limit image keeps its bytes and corrects the MIME', async () => {
  const bytes = await sharp({
    create: { width: 12, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } }
  }).png().toBuffer();
  const corrected = await prepareSubmissionImage(dataUrl('image/jpeg', bytes));
  assert.match(corrected, /^data:image\/png;base64,/);
  assert.deepEqual(decodeDataUrl(corrected), bytes);
  assert.equal(sniffMime(decodeDataUrl(corrected)), 'image/png');
});

test('the decoded-size boundary keeps 10MiB and compresses one byte over it', async () => {
  const base = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 240, g: 20, b: 20, alpha: 0.8 } }
  }).png().toBuffer();
  const atLimit = pngOfSize(base, PLATFORM_DECODED_LIMIT);
  assert.equal(atLimit.length, PLATFORM_DECODED_LIMIT);
  const atLimitUrl = dataUrl('image/png', atLimit);
  assert.equal(await prepareSubmissionImage(atLimitUrl), atLimitUrl);

  const over = pngOfSize(base, PLATFORM_DECODED_LIMIT + 1);
  assert.equal(over.length, PLATFORM_DECODED_LIMIT + 1);
  const prepared = await prepareSubmissionImage(dataUrl('image/png', over));
  const decoded = decodeDataUrl(prepared);
  assert.ok(decoded.length <= SAFE_DECODED_LIMIT);
  assert.ok(decoded.length < PLATFORM_DECODED_LIMIT);
  assert.equal(sniffMime(decoded), prepared.slice(5, prepared.indexOf(';')));
  const meta = await sharp(decoded).metadata();
  assert.equal(meta.width, 8);
  assert.equal(meta.height, 8);
  assert.equal(meta.hasAlpha, true);
});

test('a large transparent high-detail image is mildly recompressed without flattening or touching the source', async () => {
  const width = 1640;
  const height = 1600;
  const bytes = await rawImage({
    width,
    height,
    channels: 4,
    compressionLevel: 0,
    fill(raw, offset, pixel, rowWidth) {
      const x = pixel % rowWidth;
      const y = Math.floor(pixel / rowWidth);
      raw[offset] = Math.round((x / rowWidth) * 255);
      raw[offset + 1] = Math.round((y / height) * 180);
      raw[offset + 2] = 70 + (x % 40);
      raw[offset + 3] = x < 30 ? 0 : 210;
    }
  });
  assert.ok(bytes.length > PLATFORM_DECODED_LIMIT);
  const sourceFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cine-prepare-')), 'source.png');
  await fs.writeFile(sourceFile, bytes);
  const before = await fs.readFile(sourceFile);
  const original = dataUrl('image/jpeg', before);
  const prepared = await prepareSubmissionImage({ name: '选区.png', data: original });
  assert.equal(prepared.name, '选区.png');
  assert.notEqual(prepared.data, original);
  assert.equal((await fs.readFile(sourceFile)).equals(before), true);
  const decoded = decodeDataUrl(prepared.data);
  assert.ok(decoded.length <= SAFE_DECODED_LIMIT);
  assert.equal(sniffMime(decoded), 'image/png');
  const sourcePixels = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const output = await sharp(decoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, width);
  assert.equal(output.info.height, height);
  assert.equal(output.info.channels, 4);
  assert.deepEqual(output.data, sourcePixels.data);
  assert.equal(output.data[3], 0);
  assert.ok(output.data[3 + ((width - 1) * 4)] > 200);
});

test('incompressible detail above 10MB stays full size when a mild encode fits', async () => {
  const width = 1920;
  const height = 1920;
  const raw = Buffer.alloc(width * height * 3);
  randomFillSync(raw);
  const bytes = await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(bytes.length > PLATFORM_DECODED_LIMIT);
  const snapshot = Buffer.from(bytes);
  const prepared = await prepareSubmissionImages([dataUrl('image/png', bytes), 'https://cdn.example.test/a.png']);
  assert.equal(prepared.length, 2);
  assert.equal(prepared[1], 'https://cdn.example.test/a.png');
  assert.deepEqual(bytes, snapshot);
  const decoded = decodeDataUrl(prepared[0]);
  assert.ok(decoded.length <= SAFE_DECODED_LIMIT);
  assert.equal(sniffMime(decoded), prepared[0].slice(5, prepared[0].indexOf(';')));
  const meta = await sharp(decoded).metadata();
  assert.equal(meta.width, width);
  assert.equal(meta.height, height);
  assert.notEqual(meta.hasAlpha, true);
  assert.ok(decoded.length > 1_000_000);
  const source = await sharp(bytes).raw().toBuffer();
  const output = await sharp(decoded).removeAlpha().raw().toBuffer();
  let total = 0;
  const samples = Math.min(source.length, output.length, 4000);
  for (let i = 0; i < samples; i++) total += Math.abs(source[i] - output[i]);
  const mean = total / samples;
  assert.ok(mean < 15, `mean channel drift ${mean} is harsher than a mild encode`);
});

test('generate payload images are prepared without a platform request', async () => {
  const small = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#336699' }
  }).png().toBuffer();
  const smallUrl = dataUrl('image/png', small);
  const payload = await prepareGeneratePayload({
    model: 'banana-2',
    prompt: '只改窗帘',
    params: { images: [smallUrl], size: '1024x1024' }
  });
  assert.equal(payload.prompt, '只改窗帘');
  assert.equal(payload.params.size, '1024x1024');
  assert.equal(payload.params.images[0], smallUrl);
});

test('the helper prepare route serves plugin 0.1.10 without starting voice, drag, or generation', async () => {
  const calls = [];
  const server = createVoiceServer({
    spawnWorker() { calls.push('voice'); return fakeProcess(); },
    dropWindowLauncher() { calls.push('drag'); return fakeProcess(); },
    overlayLauncher() { calls.push('overlay'); return fakeProcess(); },
    annotationWindowLauncher() { calls.push('annotate'); return fakeProcess(); },
    generateProxy() { calls.push('generate'); throw new Error('must not submit'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const headers = { 'Content-Type': 'application/json', 'X-PS-Local-Voice': '1' };
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/images/prepare`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 403);
    const missing = await fetch(`http://127.0.0.1:${port}/missing`, { headers });
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).message, /本机服务没有这个接口/);
    const base = await sharp({
      create: { width: 6, height: 6, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 0.5 } }
    }).png().toBuffer();
    const atLimit = dataUrl('image/png', pngOfSize(base, PLATFORM_DECODED_LIMIT));
    const response = await fetch(`http://127.0.0.1:${port}/images/prepare`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ images: [atLimit] })
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.images, [atLimit]);
    assert.deepEqual(calls, ['voice']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('prepare does not open a paid generate connection', () => {
  const source = fsRead('../desktop/helper/voice-server.cjs');
  assert.match(source, /pathname === '\/images\/prepare'/);
  assert.match(source, /prepareGeneratePayload\(payload\)/);
  assert.doesNotMatch(source, /api\.lk888\.ai[\s\S]{0,120}images\/prepare/);
});

function fsRead(relative) {
  return require('node:fs').readFileSync(new URL(relative, import.meta.url), 'utf8');
}
