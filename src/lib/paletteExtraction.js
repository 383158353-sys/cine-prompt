const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

export function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => clamp(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return { red: 0, green: 0, blue: 0 };
  const value = Number.parseInt(match[1], 16);
  return { red: value >> 16, green: (value >> 8) & 255, blue: value & 255 };
}

const luminance = ({ red, green, blue }) => (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
const saturation = ({ red, green, blue }) => {
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
};
const temperature = ({ red, blue }) => red - blue;
const colorDistance = (a, b) => Math.hypot(a.red - b.red, a.green - b.green, a.blue - b.blue);
const isLikelySkin = ({ red, green, blue }) => red > 70 && red > green * 1.04 && green > blue * 0.92 && red - blue > 15;

function roleName(role) {
  return ({ Primary: '主色', Secondary: '辅助色', Accent: '强调色', Highlight: '高光色', Shadow: '阴影色' })[role] || '辅助色';
}

function makeCanvas(image) {
  const canvas = document.createElement('canvas');
  const size = 220;
  const ratio = Math.min(size / image.naturalWidth, size / image.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

export function analyzePaletteFromImage(image, { count = 6, variation = 50, scope = 'environment' } = {}) {
  const { canvas, context } = makeCanvas(image);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bucketSize = Math.max(10, 48 - Math.round(Number(variation) * 0.32));
  const buckets = new Map();
  let totalWeight = 0;

  for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 3) {
    const offset = pixel * 4;
    if (data[offset + 3] < 180) continue;
    const rgb = { red: data[offset], green: data[offset + 1], blue: data[offset + 2] };
    const x = (pixel % canvas.width) / canvas.width;
    const y = Math.floor(pixel / canvas.width) / canvas.height;
    const centerDistance = Math.hypot((x - 0.5) / 0.7, (y - 0.48) / 0.78);
    let weight = 1;
    if (scope === 'character') weight = centerDistance < 0.72 ? 2.4 : centerDistance < 1 ? 1.15 : 0.22;
    if (scope === 'environment' && isLikelySkin(rgb)) weight = 0.3;
    const key = `${Math.round(rgb.red / bucketSize)},${Math.round(rgb.green / bucketSize)},${Math.round(rgb.blue / bucketSize)}`;
    const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, x: 0, y: 0, weight: 0, pixels: 0 };
    bucket.red += rgb.red * weight; bucket.green += rgb.green * weight; bucket.blue += rgb.blue * weight;
    bucket.x += x * weight; bucket.y += y * weight;
    bucket.weight += weight; bucket.pixels += 1; totalWeight += weight;
    buckets.set(key, bucket);
  }

  const candidates = [...buckets.values()].map((bucket) => ({
    red: bucket.red / bucket.weight, green: bucket.green / bucket.weight, blue: bucket.blue / bucket.weight,
    x: bucket.x / bucket.weight, y: bucket.y / bucket.weight, weight: bucket.weight, pixels: bucket.pixels
  })).sort((a, b) => b.weight - a.weight);
  const selected = [];
  const minimumDistance = Math.max(20, 70 - Number(variation) * 0.43);
  for (const candidate of candidates) {
    if (selected.every((existing) => colorDistance(candidate, existing) >= minimumDistance)) selected.push(candidate);
    if (selected.length >= count) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (selected.every((existing) => colorDistance(candidate, existing) >= 8)) selected.push(candidate);
  }

  const sum = selected.reduce((value, color) => value + color.weight, 0) || totalWeight || 1;
  const percentages = selected.map((color) => Math.max(1, Math.round(color.weight / sum * 100)));
  const delta = 100 - percentages.reduce((value, entry) => value + entry, 0);
  if (percentages.length) percentages[0] += delta;
  const darkest = selected.reduce((best, color, index) => luminance(color) < luminance(selected[best]) ? index : best, 0);
  const lightest = selected.reduce((best, color, index) => luminance(color) > luminance(selected[best]) ? index : best, 0);
  const accent = selected.reduce((best, color, index) => {
    const score = saturation(color) * 1.5 + colorDistance(color, selected[0]) / 255 - percentages[index] / 180;
    const bestScore = saturation(selected[best]) * 1.5 + colorDistance(selected[best], selected[0]) / 255 - percentages[best] / 180;
    return score > bestScore ? index : best;
  }, 0);
  /** @type {string[]} */
  const roles = selected.map((_, index) => index === 0 ? 'Primary' : 'Secondary');
  if (selected.length > 2) roles[accent] = 'Accent';
  if (selected.length > 3) roles[lightest] = 'Highlight';
  if (selected.length > 4) roles[darkest] = 'Shadow';
  roles[0] = 'Primary';
  const colors = selected.map((color, index) => ({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}`,
    hex: rgbToHex(color.red, color.green, color.blue),
    rgb: { red: clamp(color.red), green: clamp(color.green), blue: clamp(color.blue) },
    percentage: percentages[index], role: roles[index], name: roleName(roles[index])
  }));
  const average = selected.reduce((acc, color, index) => {
    const weight = percentages[index] / 100;
    acc.l += luminance(color) * weight; acc.s += saturation(color) * weight; acc.t += temperature(color) * weight;
    return acc;
  }, { l: 0, s: 0, t: 0 });
  const lightRange = selected.length ? luminance(selected[lightest]) - luminance(selected[darkest]) : 0;
  const analysis = {
    temperature: average.t > 16 ? '暖' : average.t < -10 ? '冷' : '中性',
    brightness: average.l > 0.68 ? '高调' : average.l < 0.38 ? '低调' : '中调',
    saturation: average.s > 0.55 ? '高' : average.s < 0.25 ? '低' : '中',
    contrast: lightRange > 0.62 ? '高' : lightRange < 0.3 ? '低' : '中等',
    harmony: average.s < 0.28 ? '近似色与中性色关系' : (lightRange > 0.55 ? '明暗对比关系' : '相邻色关系'),
    tendency: average.t > 16 ? '整体偏暖' : average.t < -10 ? '整体偏冷' : '冷暖平衡',
    highlight_tendency: colors[lightest]?.hex || '', shadow_tendency: colors[darkest]?.hex || ''
  };
  const scopeText = scope === 'character' ? '人物主体' : '环境空间';
  analysis.description = `${analysis.saturation}饱和${analysis.temperature}色体系，以${colors[0]?.hex || ''}为${scopeText}主色，${analysis.brightness}明度、${analysis.contrast}对比，高光倾向${analysis.highlight_tendency}，阴影倾向${analysis.shadow_tendency}，${colors.find((color) => color.role === 'Accent')?.hex || colors[1]?.hex || ''}承担视觉强调。`;
  const points = selected.map((color, colorIndex) => ({
    x: Math.max(0, Math.min(100, color.x * 100)),
    y: Math.max(0, Math.min(100, color.y * 100)),
    colorIndex
  }));
  return { colors, analysis, points };
}

export function extractPaletteFromImage(image, count = 6, variation = 50, scope = 'environment') {
  return analyzePaletteFromImage(image, { count, variation, scope }).colors.map((color) => color.hex);
}

export function sampleImageColor(image, clientX, clientY) {
  const rect = image.getBoundingClientRect();
  const x = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor((clientX - rect.left) / rect.width * image.naturalWidth)));
  const y = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor((clientY - rect.top) / rect.height * image.naturalHeight)));
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return { color: rgbToHex(red, green, blue), rgb: { red, green, blue }, point: { x: (x / image.naturalWidth) * 100, y: (y / image.naturalHeight) * 100 } };
}
