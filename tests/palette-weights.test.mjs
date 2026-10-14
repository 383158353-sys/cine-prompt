import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaletteWeights, resizePaletteBoundary } from '../src/lib/paletteWeights.js';

test('palette weights normalize to 100 while preserving proportions', () => {
  const colors = normalizePaletteWeights([{ percentage: 2 }, { percentage: 1 }, { percentage: 1 }]);
  assert.deepEqual(colors.map((color) => color.percentage), [50, 25, 25]);
  assert.equal(colors.reduce((sum, color) => sum + color.percentage, 0), 100);
});

test('dragging a boundary only reallocates the adjacent pair', () => {
  const colors = [{ percentage: 40 }, { percentage: 35 }, { percentage: 25 }];
  const resized = resizePaletteBoundary(colors, 0, 12);
  assert.deepEqual(resized.map((color) => color.percentage), [52, 23, 25]);
  assert.equal(resized.reduce((sum, color) => sum + color.percentage, 0), 100);
});

test('boundary resize keeps both adjacent colors usable', () => {
  const resized = resizePaletteBoundary([{ percentage: 50 }, { percentage: 50 }], 0, 100);
  assert.deepEqual(resized.map((color) => color.percentage), [97, 3]);
});
