import test from 'node:test';
import assert from 'node:assert/strict';
import { paletteBands, createPaletteImage } from '../src/lib/paletteImage.js';

test('palette image bands use the adjusted proportions and cover the full image', () => {
  const bands = paletteBands({ colors: [{ hex: '#112233', percentage: 70 }, { hex: '#abcdef', percentage: 20 }, { hex: '#000000', percentage: 10 }] });
  assert.deepEqual(bands, [{ hex: '#112233', x: 0, width: 840 }, { hex: '#abcdef', x: 840, width: 240 }, { hex: '#000000', x: 1080, width: 120 }]);
  const thirds = paletteBands({ palette: ['#111111', '#222222', '#333333'] }, 1000);
  assert.equal(thirds.reduce((sum, band) => sum + band.width, 0), 1000);
});

test('palette reference is a PNG file with only proportional vertical color bands', () => {
  const previous = globalThis.document;
  const calls = [];
  const ctx = { fillStyle: '', fillRect(...rect) { calls.push({ color: this.fillStyle, rect }); } };
  globalThis.document = { createElement: () => ({ getContext: () => ctx, toDataURL: () => 'data:image/png;base64,aW1hZ2U=' }) };
  try {
    const image = createPaletteImage({ id: 'p1', scope: 'environment', name: '我的色卡', colors: [{ hex: '#112233', percentage: 75 }, { hex: '#abcdef', percentage: 25 }] });
    assert.equal(image.file.type, 'image/png');
    assert.equal(image.file.name, '我的色卡.png');
    assert.equal(image.paletteId, 'p1');
    assert.deepEqual(calls, [{ color: '#112233', rect: [0, 0, 900, 675] }, { color: '#abcdef', rect: [900, 0, 300, 675] }]);
  } finally { globalThis.document = previous; }
});
