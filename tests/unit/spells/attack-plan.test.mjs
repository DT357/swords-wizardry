import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAttackPlan } from '../../../module/spells/attack-plan.mjs';

test('evaluates ascending attack targets in stable snapshot order', () => {
  const results = evaluateAttackPlan({
    total: 15,
    mode: 'missile',
    useAscendingAC: true,
    attacker: { tHAC0: 19 },
    targets: [
      { uuid: 'Token.a', status: 'resolved', aac: 15, ac: 4 },
      { uuid: 'Token.b', status: 'resolved', aac: 16, ac: 3 },
      { uuid: 'Token.c', status: 'missing', aac: null, ac: null }
    ]
  });
  assert.deepEqual(results.map(({ uuid, outcome }) => ({ uuid, outcome })), [
    { uuid: 'Token.a', outcome: 'hit' },
    { uuid: 'Token.b', outcome: 'miss' },
    { uuid: 'Token.c', outcome: 'missing' }
  ]);
});
test('evaluates descending attack targets from attacker THAC0 and target AC', () => {
  assert.deepEqual(evaluateAttackPlan({
    total: 14,
    mode: 'melee',
    useAscendingAC: false,
    attacker: { tHAC0: 19 },
    targets: [{ uuid: 'Token.a', status: 'resolved', ac: 5, aac: 14 }]
  }), [{ uuid: 'Token.a', outcome: 'hit', targetNumber: 14 }]);
});

test('custom attacks and incomplete defenses remain manual', () => {
  assert.deepEqual(evaluateAttackPlan({
    total: 20,
    mode: 'custom',
    useAscendingAC: true,
    attacker: {},
    targets: [{ uuid: 'Token.a', status: 'resolved', ac: null, aac: null }]
  }), [{ uuid: 'Token.a', outcome: 'manual' }]);
});
