import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { applyUpscalePreset, upscaleRepairInstruction } from '../shared/repair-presets.mjs';

test('upscale preset locks texture detail and preserves tone and light', () => {
  const instruction = upscaleRepairInstruction();
  assert.match(instruction, /物体自身已有的材质/);
  assert.match(instruction, /色调/);
  assert.match(instruction, /光影/);
  assert.match(instruction, /Ultra-detail only/);
  const result = applyUpscalePreset({ repair_prompt_zh: '保持原图。', repair_prompt_en: 'Preserve the original image.', negative_constraints: '' });
  assert.match(result.repair_prompt_zh, /【超清】/);
  assert.match(result.repair_prompt_zh, /不.*重新上色|禁止重新上色/);
  assert.match(result.repair_prompt_en, /Do not recolor, relight/);
  assert.match(result.negative_constraints, /禁止改变色调、光影/);
  assert.equal(result.repair_preset, 'upscale');
});

test('logic repair exposes an upscale toggle that does not auto-generate', () => {
  const source = fs.readFileSync(new URL('../src/components/LogicRepair.jsx', import.meta.url), 'utf8');
  assert.match(source, />超清</);
  assert.match(source, /repair_preset: useUpscale \? UPSCALE_PRESET/);
  assert.match(source, /一键超清/);
  assert.ok(!source.includes('handleRepair(true)'), '超清 must not call handleRepair directly — generation is triggered only by the submit button');
});
