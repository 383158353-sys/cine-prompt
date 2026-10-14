import { normalizePaletteWeights } from './paletteWeights.js';

export function paletteBands(palette, width = 1200) {
  const colors = normalizePaletteWeights(palette.colors?.length ? palette.colors : (palette.palette || []).map((hex) => ({ hex })));
  let edge = 0;
  return colors.map((color, index) => {
    const start = Math.round(edge);
    edge += color.percentage / 100 * width;
    return { hex: /^#[0-9a-f]{6}$/i.test(color.hex) ? color.hex : '#000000', x: start, width: (index === colors.length - 1 ? width : Math.round(edge)) - start };
  });
}

export function createPaletteImage(palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 675;
  const ctx = canvas.getContext('2d');
  for (const band of paletteBands(palette, canvas.width)) {
    ctx.fillStyle = band.hex;
    ctx.fillRect(band.x, 0, band.width, canvas.height);
  }
  const preview = canvas.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(preview.split(',')[1]), (char) => char.charCodeAt(0));
  const file = new File([bytes], `${palette.name || '色卡'}.png`, { type: 'image/png' });
  return { file, preview, paletteId: palette.id, paletteScope: palette.scope };
}

export function downloadPalette(palette) {
  const image = createPaletteImage(palette);
  const link = document.createElement('a');
  link.href = image.preview;
  link.download = image.file.name;
  link.click();
}
