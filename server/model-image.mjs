// In-memory model copies only: no writes to original uploads, no cross-request cache.
let sharpLoader;
function loadSharp() {
  sharpLoader ||= import('sharp').then(mod => mod.default);
  return sharpLoader;
}
export async function modelImage(buffer, mime, maxBytes = 750_000) {
  const sharp = await loadSharp();
  const metadata = await sharp(buffer).metadata();
  if (buffer.length <= maxBytes && Math.max(metadata.width, metadata.height) <= 2048) {
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
  for (const edge of [2048, 1600]) {
    for (const quality of [90, 84, 78]) {
      const copy = await sharp(buffer).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true})
        .flatten({background:'#ffffff'}).jpeg({quality,mozjpeg:true}).toBuffer();
      if (copy.length <= maxBytes) return `data:image/jpeg;base64,${copy.toString('base64')}`;
    }
  }
  throw new Error('当前图片组合超过模型副本预算，请减少参考图或裁剪；原图未修改');
}
