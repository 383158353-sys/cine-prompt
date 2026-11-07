import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const helperRoot = path.join(path.resolve('desktop/helper'));
const { createVoiceServer } = require(path.join(helperRoot, 'scripts/voice-server.cjs'));
const {
  PER_FILE_DECODED,
  NOTE_ORIGINAL,
  NOTE_LOSSLESS,
  NOTE_JPEG,
  NOTE_SCALED,
  decodedBytes,
  fitUploadImages
} = require(path.join(helperRoot, 'plugin/image-budget.js'));

const PASS_THROUGH = Math.min(PER_FILE_DECODED, 10 * 1000 * 1000) - 256 * 1024;

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
function pngOfSize(base, size) {
  const extra = size - base.length;
  assert.ok(extra >= 12);
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
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('files at the safe 10MB boundary stay original and one byte over is fitted', async () => {
  const base = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.7 } }
  }).png().toBuffer();
  const atLimit = pngOfSize(base, PASS_THROUGH);
  const atUrl = dataUrl('image/png', atLimit);
  assert.equal(decodedBytes(atUrl), PASS_THROUGH);
  const kept = fitUploadImages([atUrl]);
  assert.equal(kept.compressed, false);
  assert.equal(kept.note, '');
  assert.equal(kept.images[0], atUrl);

  const over = pngOfSize(base, PASS_THROUGH + 1);
  const overUrl = dataUrl('image/png', over);
  const fitted = fitUploadImages([overUrl]);
  assert.equal(fitted.compressed, true);
  assert.notEqual(fitted.note, NOTE_ORIGINAL);
  assert.ok([NOTE_LOSSLESS, NOTE_JPEG, NOTE_SCALED].includes(fitted.note));
  assert.ok(decodedBytes(fitted.images[0]) <= PASS_THROUGH);
  assert.ok(decodedBytes(fitted.images[0]) <= 10 * 1000 * 1000);
  assert.equal(Buffer.from(over).equals(over), true);
});

test('a transparent high-detail PNG above 10MB is losslessly refit without flattening', async () => {
  const width = 1640;
  const height = 1600;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = Math.round((x / width) * 255);
      raw[i + 1] = Math.round((y / height) * 180);
      raw[i + 2] = 40;
      raw[i + 3] = x < 24 ? 0 : 220;
    }
  }
  const bytes = await sharp(raw, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(bytes.length > 10 * 1000 * 1000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cine-budget-'));
  const file = path.join(dir, 'source.png');
  fs.writeFileSync(file, bytes);
  const before = fs.readFileSync(file);
  const fitted = fitUploadImages([dataUrl('image/png', before)]);
  assert.equal(fs.readFileSync(file).equals(before), true);
  assert.equal(fitted.compressed, true);
  assert.equal(fitted.lossless, true);
  assert.equal(fitted.scaled, false);
  assert.match(fitted.images[0], /^data:image\/png;base64,/);
  assert.ok(decodedBytes(fitted.images[0]) <= PASS_THROUGH);
  const decoded = await sharp(Buffer.from(fitted.images[0].split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width);
  assert.equal(decoded.info.height, height);
  assert.equal(decoded.data[3], 0);
  assert.equal(decoded.data[((width - 1) * 4) + 3], 220);
});

test('startup and image prepare do not spawn the drop overlay, and drop offsets are retained', async () => {
  const calls = [];
  const server = createVoiceServer({
    spawnWorker() { calls.push('voice'); return fakeProcess(); },
    overlayLauncher() { calls.push('overlay'); return fakeProcess(); },
    dropWindowLauncher() { calls.push('popup'); return fakeProcess(); },
    annotationWindowLauncher() { calls.push('annotate'); return fakeProcess(); },
    generateProxy() { calls.push('generate'); throw new Error('must not submit'); }
  });
  const port = await listen(server);
  const headers = { 'Content-Type': 'application/json', 'X-PS-Local-Voice': '1' };
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { headers })).status, 200);
    const tiny = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } }
    }).png().toBuffer();
    const prepared = await fetch(`http://127.0.0.1:${port}/images/prepare`, {
      method: 'POST', headers, body: JSON.stringify({ images: [dataUrl('image/png', tiny)] })
    });
    const body = await prepared.json();
    assert.equal(prepared.status, 200, JSON.stringify(body));
    assert.equal(body.prepared, true);
    assert.equal(body.compressed, false);
    assert.deepEqual(body.images, [dataUrl('image/png', tiny)]);
    assert.deepEqual(calls, ['voice']);

    const cover = await fetch(`http://127.0.0.1:${port}/drop/cover`, {
      method: 'POST', headers,
      body: JSON.stringify({ x: 10, y: 12, left: 3, top: 4, width: 80, height: 50, offsetX: 7, offsetY: -5 })
    });
    assert.equal(cover.status, 200);
    const overlay = await (await fetch(`http://127.0.0.1:${port}/drop/overlay`, { headers })).json();
    assert.equal(overlay.offsetX, 7);
    assert.equal(overlay.offsetY, -5);
    assert.equal(overlay.left, 3);
    assert.equal(overlay.top, 4);
    assert.equal(overlay.width, 80);
    assert.equal(overlay.height, 50);
    assert.deepEqual(calls, ['voice', 'overlay']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the shipped helper keeps installed offsets and does not open an overlay on startup', () => {
  const source = fs.readFileSync(path.join(helperRoot, 'scripts/voice-server.cjs'), 'utf8');
  assert.match(source, /offsetX: null, offsetY: null/);
  assert.match(source, /offsetX=num\(parsed&&parsed\.offsetX\)/);
  assert.match(source, /offsetY=num\(parsed&&parsed\.offsetY\)/);
  assert.match(source, /offsetX,offsetY/);
  assert.match(source, /require\('\.\.\/plugin\/image-budget'\)\.fitUploadImages/);
  assert.doesNotMatch(source, /ensureOverlay\(\)\}catch/);
  assert.match(source, /server\.listen\(PORT,'127\.0\.0\.1'\);/);
  assert.doesNotMatch(source, /openDropOverlay\(\);\}\);server\.listen/);
});
