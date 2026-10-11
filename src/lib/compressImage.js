// Create a separate model copy; the original File and preview stay untouched.
const MAX_LONG_EDGE = 2048;
const MAX_COPY_BYTES = 750_000;
const copies = new WeakSet();

export async function compressImage(file, maxLongEdge = MAX_LONG_EDGE) {
  if (!file?.type?.startsWith('image/')) return file;
  if (copies.has(file)) return file;
  if (file.size > 25 * 1024 * 1024) throw new Error('请选择不超过 25MB 的原图');
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片无法解码，请使用 JPEG、PNG 或 WebP'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    for (const edge of [...new Set([maxLongEdge, Math.min(maxLongEdge, 1600)])]) {
      const scale = Math.min(1, edge / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器无法创建图片副本');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.84, 0.78]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= MAX_COPY_BYTES) {
          const copy = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
          copies.add(copy);
          return copy;
        }
      }
    }
    throw new Error('图片细节过多，无法在保留质量的情况下生成上传副本，请裁剪后重试');
  } finally {
    URL.revokeObjectURL(url);
    img.src = '';
  }
}

export async function compressImages(files, maxLongEdge) {
  const result = [];
  // Avoid decoding several 20MB originals at the same time.
  for (const file of files || []) result.push(await compressImage(file, maxLongEdge));
  return result;
}
