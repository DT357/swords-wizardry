import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HitPointValidationError,
  calculateHitPointChange,
  classifyPendingApplication,
  createApplicationId,
  createTargetFingerprint,
  redactTargetFingerprint,
  validateApplyPayload
} from '../../../module/hit-points/domain.mjs';

test('HP calculation supports the four approved modes and clamps to bounds', () => {
  assert.deepEqual(calculateHitPointChange({
    mode: 'fullDamage', current: 7, maximum: 10, amount: 5
  }), { kind: 'damage', multiplier: 1, oldHP: 7, newHP: 2, requestedAmount: 5, appliedAmount: 5 });
  assert.equal(calculateHitPointChange({
    mode: 'halfDamage', current: 7, maximum: 10, amount: 5
  }).newHP, 5);
  assert.equal(calculateHitPointChange({
    mode: 'doubleDamage', current: 7, maximum: 10, amount: 5
  }).newHP, 0);
  assert.equal(calculateHitPointChange({
    mode: 'healing', current: 7, maximum: 10, amount: 5
  }).newHP, 10);
});

test('HP calculation rejects unsafe or unsupported values', () => {
  for (const input of [
    { mode: 'delete', current: 1, maximum: 1, amount: 1 },
    { mode: 'fullDamage', current: -1, maximum: 1, amount: 1 },
    { mode: 'fullDamage', current: 1, maximum: -1, amount: 1 },
    { mode: 'fullDamage', current: 1, maximum: 1, amount: NaN },
    { mode: 'fullDamage', current: 1, maximum: 1, amount: 1_000_001 }
  ]) {
    assert.throws(() => calculateHitPointChange(input), HitPointValidationError);
  }
});

test('application identity is stable per result and target regardless of mode', () => {
  const first = createApplicationId({
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Scene.scene1.Token.token1'
  });
  const second = createApplicationId({
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Scene.scene1.Token.token1'
  });
  const other = createApplicationId({
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Scene.scene1.Token.token2'
  });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^hp-[a-f0-9]{8}$/);
});

test('target fingerprints distinguish stable UUID, Actor, HP, and revision', () => {
  const fingerprint = createTargetFingerprint({
    targetUuid: 'Scene.scene1.Token.token1',
    actor: {
      uuid: 'Scene.scene1.Token.token1.Actor.actor1',
      system: { hp: { value: 8 } },
      _stats: { modifiedTime: 123 }
    }
  });
  assert.deepEqual(fingerprint, {
    targetUuid: 'Scene.scene1.Token.token1',
    actorUuid: 'Scene.scene1.Token.token1.Actor.actor1',
    hp: 8,
    modifiedTime: 123
  });
  assert.deepEqual(redactTargetFingerprint(fingerprint), {
    targetUuid: 'Scene.scene1.Token.token1',
    actorUuid: 'Scene.scene1.Token.token1.Actor.actor1',
    modifiedTime: 123
  });
});

test('pending recovery distinguishes retry, applied, and conflict', () => {
  const pending = {
    before: { targetUuid: 'Actor.a1', actorUuid: 'Actor.a1', modifiedTime: 100 }
  };
  assert.equal(classifyPendingApplication(pending, {
    targetUuid: 'Actor.a1', actorUuid: 'Actor.a1', hp: 10, modifiedTime: 100
  }), 'retry');
  assert.equal(classifyPendingApplication(pending, {
    targetUuid: 'Actor.a1', actorUuid: 'Actor.a1', hp: 5, modifiedTime: 101
  }, { appliedMarker: true }), 'applied');
  assert.equal(classifyPendingApplication(pending, {
    targetUuid: 'Actor.a1', actorUuid: 'Actor.a1', hp: 7, modifiedTime: 102
  }), 'conflict');
  assert.equal(classifyPendingApplication({
    ...pending,
    before: { ...pending.before, modifiedTime: null }
  }, {
    targetUuid: 'Actor.a1', actorUuid: 'Actor.a1', hp: 10, modifiedTime: null
  }), 'conflict');
});

test('apply payload accepts only result reference, target, and approved mode', () => {
  assert.deepEqual(validateApplyPayload({
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Actor.target1',
    mode: 'fullDamage'
  }), {
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Actor.target1',
    mode: 'fullDamage'
  });
  assert.throws(() => validateApplyPayload({
    messageUuid: 'ChatMessage.result1',
    targetUuid: 'Actor.target1',
    mode: 'fullDamage',
    amount: 999
  }), HitPointValidationError);
});
