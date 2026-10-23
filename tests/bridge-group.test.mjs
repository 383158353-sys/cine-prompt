import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bridgeBannerCopy, bridgeIdFromSearch, initialEnhanceGroup } from '../src/lib/bridgeSession.js';

test('a bridge query selects logic repair before the session fetch', () => {
  assert.equal(bridgeIdFromSearch(''), '');
  assert.equal(bridgeIdFromSearch('?restore=prompt-1'), '');
  assert.equal(initialEnhanceGroup(''), 'character');
  assert.equal(initialEnhanceGroup('?restore=prompt-1'), 'character');
  assert.equal(bridgeIdFromSearch('?bridge=sess-1'), 'sess-1');
  assert.equal(bridgeIdFromSearch('bridge=sess-1'), 'sess-1');
  assert.equal(initialEnhanceGroup('?bridge=sess-1&restore=old'), 'repair');
  assert.equal(initialEnhanceGroup('?foo=1&bridge=abc'), 'repair');
  assert.equal(bridgeIdFromSearch('?bridge='), '');
  assert.equal(bridgeIdFromSearch('?bridge=%20'), '');
  assert.equal(initialEnhanceGroup('?bridge=%20'), 'character');
});

test('repair bridge banner describes logic repair instead of the enhance flow', () => {
  const pending = bridgeBannerCopy({ group: 'repair', completed: false });
  assert.match(pending, /逻辑修复/);
  assert.match(pending, /生成修复提示词/);
  assert.match(pending, /回传 PS/);
  assert.doesNotMatch(pending, /点击增强/);
  assert.doesNotMatch(pending, /角色\/环境/);

  const done = bridgeBannerCopy({ group: 'repair', completed: true });
  assert.match(done, /逻辑修复/);
  assert.match(done, /修复提示词/);
  assert.match(done, /回传 PS/);
  assert.doesNotMatch(done, /点击增强/);
  assert.doesNotMatch(done, /已增强/);
  assert.doesNotMatch(done, /角色\/环境/);

  const enhance = bridgeBannerCopy({ group: 'character', completed: false });
  assert.match(enhance, /角色\/环境/);
  assert.match(enhance, /点击增强/);
  const enhanceDone = bridgeBannerCopy({ group: 'scene', completed: true });
  assert.match(enhanceDone, /已增强并回传 PS/);
});

test('the workbench applies repair on the first render and still posts the repair result back', () => {
  const source = fs.readFileSync(new URL('../src/components/PromptEnhancer.jsx', import.meta.url), 'utf8');
  assert.match(source, /useState\(\(\) => initialEnhanceGroup\(/);
  assert.match(source, /if \(bridgeIdFromSearch\(location\.search\)\) return;/);
  assert.match(source, /setGroup\('repair'\)/);
  assert.match(source, /bridgeBannerCopy\(\{ group, completed: bridgeCompleted \}\)/);
  assert.match(source, /sharedImages=\{images\}/);
  assert.match(source, /sharedContext=\{rawInput\}/);
  assert.match(source, /onBridgeComplete=\{bridgeSessionId && !bridgeCompleted/);
  assert.match(source, /bridge-session\/complete/);
});
