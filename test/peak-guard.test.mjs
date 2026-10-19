import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHours, inPeakHours, internals, setup, providers } from '../plugins/peak-guard/index.js';

const base = {
  enabled: true,
  mode: 'strict',
  peakHours: '0-23',
  onlyGroups: true,
  groupPerMin: 1,
  globalPerMin: 10,
  maxOutputTokens: 300,
  exemptAt: true,
  exemptCommands: true
};

function reset(config = {}) {
  setup({ config: () => ({ ...base, ...config }), log: () => {} });
  internals.buckets.clear();
}

test('parseHours 支持多段与跨夜', () => {
  assert.deepEqual(parseHours('9-12,14-18'), [[9, 12], [14, 18]]);
  assert.deepEqual(parseHours('22-2'), [[22, 2]]);
  assert.deepEqual(parseHours('bad,25-30'), []);
});

test('inPeakHours 处理跨夜', () => {
  assert.equal(inPeakHours('22-2', 23), true);
  assert.equal(inPeakHours('22-2', 1), true);
  assert.equal(inPeakHours('22-2', 12), false);
  assert.equal(inPeakHours('9-12', 9), true);
  assert.equal(inPeakHours('9-12', 12), false);
});

test('strict 模式下每群预算生效', () => {
  reset();
  const ctx = { chatKey: 'group:1', isPrivate: false, atMe: false, isCommand: false };
  assert.equal(internals.gate(ctx).allow, true);
  const second = internals.gate(ctx);
  assert.equal(second.allow, false);
  assert.match(second.reason, /预算/);
});

test('@、命令、私聊默认豁免', () => {
  reset();
  assert.equal(internals.gate({ chatKey: 'group:1', isPrivate: false, atMe: true }).allow, true);
  assert.equal(internals.gate({ chatKey: 'group:1', isPrivate: false, atMe: false, isCommand: true }).allow, true);
  assert.equal(internals.gate({ chatKey: 'private:1', isPrivate: true, atMe: false }).allow, true);
});

test('request-params 在 strict 下限制输出 token', () => {
  reset();
  const out = providers['llm.request-params']({ body: { max_tokens: 2000 } });
  assert.equal(out.body.max_tokens, 300);
  const out2 = providers['llm.request-params']({ body: {} });
  assert.equal(out2.body.max_tokens, 300);
});

test('off 模式不拦截', () => {
  reset({ mode: 'off' });
  const ctx = { chatKey: 'group:9', isPrivate: false, atMe: false, isCommand: false };
  for (let i = 0; i < 5; i++) assert.equal(internals.gate(ctx).allow, true);
});
