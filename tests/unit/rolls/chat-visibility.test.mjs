import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyFoundryChatVisibility,
  readFoundryRollMode
} from '../../../module/rolls/chat-visibility.mjs';

test('roll mode reads the current v14 setting and falls back to the v13 setting', () => {
  const v14Reads = [];
  const v14 = {
    settings: new Map([['core.messageMode', {}], ['core.rollMode', {}]]),
    get(namespace, key) {
      v14Reads.push(`${namespace}.${key}`);
      return key === 'messageMode' ? 'blind' : 'blindroll';
    }
  };
  assert.equal(readFoundryRollMode(v14), 'blind');
  assert.deepEqual(v14Reads, ['core.messageMode']);

  const v13 = {
    settings: new Map([['core.rollMode', {}]]),
    get(namespace, key) {
      assert.equal(namespace, 'core');
      assert.equal(key, 'rollMode');
      return 'selfroll';
    }
  };
  assert.equal(readFoundryRollMode(v13), 'selfroll');
});

test('chat visibility adapts every canonical mode for v13 and v14', () => {
  const v13Calls = [];
  const v14Calls = [];
  const v13 = {
    applyRollMode(data, mode) { v13Calls.push(mode); data.applied = mode; return data; }
  };
  const v14 = {
    applyMode(data, mode) { v14Calls.push(mode); data.applied = mode; return data; }
  };
  const modes = ['publicroll', 'gmroll', 'blindroll', 'selfroll'];
  for (const mode of modes) {
    const legacy = applyFoundryChatVisibility(v13, { content: mode, rollMode: mode });
    const current = applyFoundryChatVisibility(v14, { content: mode, rollMode: mode });
    assert.equal('rollMode' in legacy, false);
    assert.equal('rollMode' in current, false);
  }
  assert.deepEqual(v13Calls, modes);
  assert.deepEqual(v14Calls, ['public', 'gm', 'blind', 'self']);
});

test('chat visibility does not mutate caller data and rejects an unavailable API', () => {
  const data = { content: 'safe', rollMode: 'gmroll' };
  const result = applyFoundryChatVisibility({
    applyMode(candidate) { candidate.changed = true; return candidate; }
  }, data);
  assert.deepEqual(data, { content: 'safe', rollMode: 'gmroll' });
  assert.equal(result.changed, true);
  assert.throws(() => applyFoundryChatVisibility({}, data), TypeError);
});

test('chat visibility preserves live Roll instances without structured cloning them', () => {
  const roll = { total: 7, evaluate() {} };
  const rolls = [roll];
  const data = { content: 'safe', rollMode: 'publicroll', rolls };
  const result = applyFoundryChatVisibility({
    applyRollMode(candidate) {
      candidate.whisper = [];
      return candidate;
    }
  }, data);

  assert.notEqual(result.rolls, rolls);
  assert.equal(result.rolls[0], roll);
  assert.equal(data.whisper, undefined);
});
