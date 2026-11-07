// In-memory copies only. Under-limit originals are returned unchanged and nothing is written to disk.
const path = require('node:path');

const PLATFORM_DECODED_LIMIT = 10 * 1024 * 1024;
const SAFE_DECODED_LIMIT = Math.floor(9.5 * 1024 * 1024);
const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i;

let sharpModule;
function loadSharp() {
  if (sharpModule) return sharpModule;
  const loaded = resolveSharp();
  loaded.cache(false);
  loaded.concurrency(1);
  sharpModule = loaded;
  return sharpModule;
}
function resolveSharp() {
  try { return require('sharp'); }
  catch { /* Packaged helper lives outside the app node_modules tree. */ }
  const candidates = [
    path.join(__dirname, '..', '..', 'node_modules', 'sharp'),
    path.join(__dirname, '..', '..', 'app', 'node_modules', 'sharp'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'node_modules', 'sharp') : ''
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); }
    catch { /* Try the next layout. */ }
  }
  throw new Error('本机图片预处理组件不可用');
}

function sniffMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function declaredMime(type) {
  const mime = String(type || '').toLowerCase();
  if (mime === 'image/jpg' || mime === 'image/jpeg') return 'image/jpeg';
  if (mime === 'image/png' || mime === 'image/webp') return mime;
  return '';
}

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function readImageValue(value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return { passthrough: true };
  const source = typeof value === 'string' ? value : value && typeof value.data === 'string' ? value.data : '';
  const match = DATA_URL.exec(source);
  if (!match) return { passthrough: true };
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) return { passthrough: true };
  return { bytes, mime: declaredMime(`image/${match[1].toLowerCase()}`) };
}

function withData(value, next) {
  return typeof value === 'string' ? next : { ...value, data: next };
}

async function encodeCopy(bytes, { width, height, scale, format, quality }) {
  const sharp = loadSharp();
  let pipeline = sharp(bytes, { failOn: 'none' });
  if (scale < 1) {
    pipeline = pipeline.resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), {
      fit: 'fill',
      kernel: 'lanczos3',
      withoutEnlargement: true
    });
  }
  if (format === 'png') return pipeline.png({ compressionLevel: 9 }).toBuffer();
  if (format === 'webp') return pipeline.webp({ quality, alphaQuality: 100, effort: 2, smartSubsample: false }).toBuffer();
  return pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function compressOversize(bytes) {
  const sharp = loadSharp();
  const meta = await sharp(bytes, { failOn: 'none' }).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;
  const hasAlpha = meta.hasAlpha === true;
  const candidates = [];
  if (hasAlpha || meta.format === 'png' || meta.format === 'webp') candidates.push({ format: 'png', scale: 1 });
  if (!hasAlpha) {
    for (const quality of [93, 90, 86, 82, 78]) candidates.push({ format: 'jpeg', scale: 1, quality });
  }
  for (const scale of [0.92, 0.84, 0.75, 0.66, 0.55, 0.45, 0.35, 0.25]) {
    if (hasAlpha) {
      candidates.push({ format: 'png', scale });
      candidates.push({ format: 'webp', scale, quality: 92 });
    } else {
      candidates.push({ format: 'jpeg', scale, quality: 88 });
    }
  }
  for (const candidate of candidates) {
    const encoded = await encodeCopy(bytes, { width, height, ...candidate });
    if (encoded.length > 0 && encoded.length <= SAFE_DECODED_LIMIT) {
      const format = candidate.format === 'jpeg' ? 'image/jpeg' : candidate.format === 'webp' ? 'image/webp' : 'image/png';
      return { bytes: encoded, mime: format };
    }
  }
  throw new Error('图片压缩后仍超过平台单文件 10MB 限制');
}

async function prepareSubmissionImage(value) {
  const read = readImageValue(value);
  if (read.passthrough) return value;
  const actual = sniffMime(read.bytes);
  if (read.bytes.length <= PLATFORM_DECODED_LIMIT) {
    if (!actual || actual === read.mime) return value;
    return withData(value, dataUrl(actual, read.bytes));
  }
  const fitted = await compressOversize(read.bytes);
  if (sniffMime(fitted.bytes) !== fitted.mime) throw new Error('压缩结果与图片类型不一致');
  return withData(value, dataUrl(fitted.mime, fitted.bytes));
}

async function prepareSubmissionImages(images) {
  if (!Array.isArray(images)) throw new Error('图片列表格式无效');
  const prepared = [];
  for (const image of images) prepared.push(await prepareSubmissionImage(image));
  return prepared;
}

async function prepareGeneratePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const next = { ...payload };
  if (Array.isArray(next.images)) next.images = await prepareSubmissionImages(next.images);
  if (next.params && typeof next.params === 'object' && !Array.isArray(next.params) && Array.isArray(next.params.images)) {
    next.params = { ...next.params, images: await prepareSubmissionImages(next.params.images) };
  }
  return next;
}

module.exports = {
  PLATFORM_DECODED_LIMIT,
  SAFE_DECODED_LIMIT,
  prepareSubmissionImage,
  prepareSubmissionImages,
  prepareGeneratePayload,
  sniffMime
};
