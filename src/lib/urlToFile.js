// 将图片 URL 转换为 File 对象（用于从历史记录恢复的图片需要标注等场景）
export async function urlToFile(url, filename = 'image.png') {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}