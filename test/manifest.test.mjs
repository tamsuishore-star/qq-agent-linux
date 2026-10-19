import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManifest, SKILL_API_VERSION } from '../src/skills/manifest.js';

test('normalizeManifest: 合法清单补齐默认值并去重', () => {
  const { manifest, problems } = normalizeManifest({
    id: 'demo-skill',
    name: '演示',
    version: '1.2.3',
    capabilities: ['demo.read', 'demo.read'],
    requires: ['demo.read', 'demo.write']
  });
  assert.equal(problems.length, 0);
  assert.equal(manifest.id, 'demo-skill');
  assert.equal(manifest.apiVersion, SKILL_API_VERSION);
  assert.deepEqual(manifest.capabilities, ['demo.read']);
  // 自依赖（requires 里同时出现在 capabilities）应被移除
  assert.deepEqual(manifest.requires, ['demo.write']);
  assert.equal(manifest.enabledByDefault, true);
});

test('normalizeManifest: 缺少 id 时使用 fallbackId', () => {
  const { manifest, problems } = normalizeManifest({ name: '无 id' }, { fallbackId: 'fallback-id' });
  assert.equal(manifest.id, 'fallback-id');
  // fallbackId 已补上 id，因此不应再报“缺少 id”
  assert.equal(problems.some((p) => p.includes('缺少 id')), false);
});

test('normalizeManifest: 非法 category 回退为 utility 并给出提示', () => {
  const { manifest, problems } = normalizeManifest({ id: 'x', category: 'not-a-category' });
  assert.equal(manifest.category, 'utility');
  assert.ok(problems.some((p) => p.includes('category')));
});

test('normalizeManifest: apiVersion 高于当前支持时给出问题', () => {
  const { problems } = normalizeManifest({ id: 'x', apiVersion: SKILL_API_VERSION + 1 });
  assert.ok(problems.some((p) => p.includes('apiVersion')));
});

test('normalizeManifest: 非对象返回空清单', () => {
  const { manifest, problems } = normalizeManifest(null);
  assert.equal(manifest, null);
  assert.equal(problems.length, 1);
});
