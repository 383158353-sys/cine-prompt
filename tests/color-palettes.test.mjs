import test from 'node:test';
import assert from 'node:assert/strict';
import { buildColorPaletteInstruction, normalizeColorPalette } from '../shared/color-palettes.mjs';

const character = {
  id: 'character-one', name: '冷青人物', scope: 'character',
  palette: ['#173F46', '#527B78', '#B8CBC5', '#E9E2D2'], variation: 62,
  colors: [
    { name: '深青主色', hex: '#173F46', percentage: 52, role: 'Primary' },
    { name: '灰绿辅助', hex: '#527B78', percentage: 25, role: 'Secondary' },
    { name: '雾青高光', hex: '#B8CBC5', percentage: 18, role: 'Highlight' },
    { name: '奶油强调', hex: '#E9E2D2', percentage: 5, role: 'Accent' }
  ],
  analysis: { temperature: '冷', brightness: '中低', saturation: '低', contrast: '中等', shadow_tendency: '#173F46' }
};
const environment = {
  id: 'environment-one', name: '薄雾海岸', scope: 'environment',
  palette: ['#236A73', '#647D92', '#D8E2DF', '#C8A97E'], variation: 48
};

test('palette normalization rejects cross-scope data and invalid colors', () => {
  assert.equal(normalizeColorPalette(character, 'environment'), null);
  assert.equal(normalizeColorPalette(environment, 'character'), null);
  assert.deepEqual(normalizeColorPalette({ ...character, palette: ['#123', 'bad', '#ABCDEF'] }, 'character').palette, ['#112233', '#ABCDEF']);
});
test('character palette prompt recolors character while locking identity and scene emphasis', () => {
  const prompt = buildColorPaletteInstruction(character, 'character');
  assert.match(prompt, /头发、皮肤与五官局部色彩/);
  assert.match(prompt, /保持人物身份、脸型五官/);
  assert.match(prompt, /背景不得喧宾夺主/);
  assert.match(prompt, /深青主色 #173F46（Primary，52%）/);
  assert.match(prompt, /色温冷，明度中低，饱和度低，对比度中等/);
  assert.match(prompt, /不得重新设计角色/);
  assert.doesNotMatch(prompt, /天空、海面\/水面/);
});

test('environment palette prompt recolors atmosphere while excluding character analysis', () => {
  const prompt = buildColorPaletteInstruction(environment, 'environment');
  assert.match(prompt, /天空、海面\/水面、地面/);
  assert.match(prompt, /雾感、空气透视/);
  assert.match(prompt, /禁止分析或改写人物五官/);
  assert.doesNotMatch(prompt, /服装主副色/);
});

