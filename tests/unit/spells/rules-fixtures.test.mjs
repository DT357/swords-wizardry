import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSpellActions } from '../../../module/spells/domain.mjs';

const fixtures = {
  cureLightWounds: [
    { id: 'cure', kind: 'healing', label: 'Cure', formula: '1d6 + 1', target: { mode: 'single' } },
    { id: 'cause', kind: 'damage', label: 'Cause', formula: '1d6 + 1', target: { mode: 'single' }, notes: 'Reversed form; referee adjudicates restrictions.' }
  ],
  fireball: [
    { id: 'damage', kind: 'damage', label: 'Fire damage', formula: '(@spell.casterLevel)d6', target: { mode: 'selected' }, save: { outcome: 'half', notes: 'Save for half.' } }
  ],
  holdPerson: [
    { id: 'save', kind: 'manual', label: 'Saving throw', target: { mode: 'selected' }, save: { outcome: 'negates', notes: 'A successful save negates the effect.' } },
    { id: 'effect', kind: 'manual', label: 'Track held creatures', notes: 'Referee tracks duration and affected creatures.' }
  ],
  magicMissile: [
    { id: 'automatic', kind: 'damage', label: 'Automatic missile', formula: '1d4 + 1', target: { mode: 'manual' }, notes: 'Invoke once per allocated missile.' },
    { id: 'attack', kind: 'attack', label: 'Attack-roll variant', formula: '1d20 + 1', attack: { mode: 'missile', notes: 'Referee-selected procedure.' }, target: { mode: 'single' } }
  ],
  heatMetal: [
    { id: 'round-one', kind: 'manual', label: 'Round 1', notes: 'Track the first-round effect manually.' },
    { id: 'round-two', kind: 'damage', label: 'Round 2 damage', formula: '1d4', target: { mode: 'selected' } },
    { id: 'later-rounds', kind: 'manual', label: 'Later rounds', notes: 'Referee tracks the remaining schedule.' }
  ]
};

for (const [name, actions] of Object.entries(fixtures)) {
  test(`normalizes the ${name} rules fixture without inventing state automation`, () => {
    const normalized = normalizeSpellActions(actions);
    assert.equal(normalized.length, actions.length);
    assert.deepEqual(normalized.map((action) => action.id), actions.map((action) => action.id));
  });
}
