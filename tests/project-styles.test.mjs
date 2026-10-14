import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_STYLES, projectStylePayload, buildProjectStyleInstruction } from '../shared/project-styles.mjs';

const style = { name: '短片项目', system_prompt: '暖色调', character_prompt: '人物穿蓝色外套', scene_prompt: '建筑使用白色石材' };

test('shared project style applies the appropriate subject requirements', () => {
  const character = buildProjectStyleInstruction(style, { direction: 'character_default' });
  assert.match(character, /人物穿蓝色外套/);
  assert.doesNotMatch(character, /建筑使用白色石材/);
  const scene = buildProjectStyleInstruction(style, { direction: 'scene_default' });
  assert.match(scene, /建筑使用白色石材/);
  assert.doesNotMatch(scene, /人物穿蓝色外套/);
  assert.match(scene, /暖色调/);
});

test('viewpoints use their selected subject and repairs identify the actual local target', () => {
  const viewpoint = buildProjectStyleInstruction(style, { mode: 'sheet', subject: 'scene' });
  assert.doesNotMatch(viewpoint, /人物穿蓝色外套/);
  const repair = buildProjectStyleInstruction(style, { mode: 'repair', group: 'scene' });
  assert.match(repair, /人物专属要求：人物穿蓝色外套/);
  assert.match(repair, /场景专属要求：建筑使用白色石材/);
  assert.match(repair, /根据图片、用户要求和标注自动识别/);
  assert.match(repair, /不得因选择项目风格而重做全图/);
});

test('the two built-in project styles support both character and scene', () => {
  assert.deepEqual(PROJECT_STYLES.map((item) => item.name), ['真人写实', '概念设定']);
  for (const style of PROJECT_STYLES) {
    assert.ok(style.character_prompt && style.scene_prompt);
    assert.match(buildProjectStyleInstruction(style, { group: 'scene' }), /当前主体：场景/);
  }
  assert.match(buildProjectStyleInstruction({ name: '自定义写实', base_style: 'realistic' }, { group: 'scene' }), /实景摄影/);
});

test('legacy project descriptions remain available with subject separation instructions', () => {
  assert.equal(projectStylePayload(null), undefined);
  const text = buildProjectStyleInstruction({ name: '旧项目', system_prompt: '原有项目描述' });
  assert.match(text, /原有项目描述/);
  assert.match(text, /人物要求与场景要求必须分别理解/);
  assert.equal(projectStylePayload({ system_prompt: 'x'.repeat(7000) }).system_prompt.length, 6000);
});
