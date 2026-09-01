import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyInitiativeSide,
  planSideInitiativeUpdates
} from '../../../module/combat/side-initiative.mjs';

test('friendly combatants are party and neutral/hostile combatants are opponents', () => {
  assert.equal(classifyInitiativeSide(1), 'party');
  assert.equal(classifyInitiativeSide(0), 'opponent');
  assert.equal(classifyInitiativeSide(-1), 'opponent');
});

test('side initiative plans one stable update per resolvable combatant', () => {
  const combatants = [
    { id: 'z', token: { disposition: -1 } },
    { id: 'a', token: { disposition: 1 } },
    { id: 'n', token: { disposition: 0 } },
    { id: 'missing-token', token: null },
    null
  ];
  assert.deepEqual(planSideInitiativeUpdates(combatants, {
    partyTotal: 5,
    opponentTotal: 2
  }), [
    { _id: 'z', initiative: 2 },
    { _id: 'a', initiative: 5 },
    { _id: 'n', initiative: 2 }
  ]);
});

test('empty combat and tied sides are deterministic', () => {
  assert.deepEqual(planSideInitiativeUpdates([], {
    partyTotal: 4, opponentTotal: 4
  }), []);
  assert.deepEqual(planSideInitiativeUpdates([
    { id: 'party', token: { disposition: 1 } },
    { id: 'enemy', token: { disposition: -1 } }
  ], { partyTotal: 4, opponentTotal: 4 }), [
    { _id: 'party', initiative: 4 },
    { _id: 'enemy', initiative: 4 }
  ]);
});

test('invalid side totals fail before any update plan is returned', () => {
  assert.throws(() => planSideInitiativeUpdates([], {
    partyTotal: Number.NaN, opponentTotal: 1
  }), /INVALID_INITIATIVE_TOTAL/);
});
