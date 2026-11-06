import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { imageUrl, MISSING_UPLOAD_MESSAGE } from '../server/ai.mjs';
import { releaseSessionUploads } from '../server/bridge.mjs';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cine-bridge-uploads-'));
}

test('bridge expiry keeps uploads still referenced by local data and deletes orphans', async () => {
  const dir = await tempDir();
  const keep = path.join(dir, '393abe35-b8fc-4424-9b6f-8c1ab785453f.png');
  const thumb = path.join(dir, 'thumb.webp');
  const orphan = path.join(dir, 'orphan.png');
  await fs.writeFile(keep, 'keep');
  await fs.writeFile(thumb, 'thumb');
  await fs.writeFile(orphan, 'orphan');
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify({
    Prompt: [{ context: { file_urls: ['/uploads/393abe35-b8fc-4424-9b6f-8c1ab785453f.png'], note: 'orphan.png is only prose' } }],
    StyleLibrary: [{ thumbnail_url: 'http://127.0.0.1:5173/uploads/thumb.webp' }]
  }));
  try {
    await releaseSessionUploads([
      { path: keep, url: '/uploads/393abe35-b8fc-4424-9b6f-8c1ab785453f.png' },
      { path: thumb, url: '/uploads/thumb.webp' },
      { path: orphan, url: '/uploads/orphan.png' }
    ], dir);
    assert.equal(await fs.readFile(keep, 'utf8'), 'keep');
    assert.equal(await fs.readFile(thumb, 'utf8'), 'thumb');
    await assert.rejects(fs.access(orphan), { code: 'ENOENT' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('bridge expiry still removes uploads when nothing in local data references them', async () => {
  const dir = await tempDir();
  const orphan = path.join(dir, 'gone.png');
  await fs.writeFile(orphan, 'gone');
  try {
    await releaseSessionUploads([{ path: orphan, url: '/uploads/gone.png' }], dir);
    await assert.rejects(fs.access(orphan), { code: 'ENOENT' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('bridge expiry keeps uploads when local data cannot be read', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'kept.png');
  await fs.writeFile(file, 'kept');
  await fs.mkdir(path.join(dir, 'db.json'));
  try {
    await releaseSessionUploads([{ path: file, url: '/uploads/kept.png' }], dir);
    assert.equal(await fs.readFile(file, 'utf8'), 'kept');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('session expiry releases uploads through the reference check', () => {
  const source = readFileSync(new URL('../server/bridge.mjs', import.meta.url), 'utf8');
  assert.match(source, /await releaseSessionUploads\(session\.files\)/);
  assert.doesNotMatch(source, /\(session\.files \|\| \[\]\)\.map\(file => fs\.unlink/);
});

test('a missing upload read explains that the reference image is gone', async () => {
  await assert.rejects(
    imageUrl('/uploads/393abe35-b8fc-4424-9b6f-8c1ab785453f.png'),
    error => {
      assert.equal(error.message, MISSING_UPLOAD_MESSAGE);
      assert.equal(error.status, 404);
      assert.equal(error.code, undefined);
      assert.equal(error.cause.code, 'ENOENT');
      assert.doesNotMatch(error.message, /ENOENT|no such file|AppData|uploads\\/i);
      return true;
    }
  );
});
