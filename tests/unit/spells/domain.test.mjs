import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SpellValidationError,
  buildSpellMessageSnapshot,
  consumePreparedSpell,
  createSpellRollData,
  fingerprintAction,
  normalizeSpellAction,
  normalizeSpellActions,
  planSpellAction,
  resolveCasterLevel,
  validateFormulaReferences
} from '../../../module/spells/domain.mjs';
import { SPELL_MESSAGE_SCHEMA_VERSION } from '../../../module/spells/constants.mjs';

const damageAction = {
  id: 'action-damage',
  kind: 'damage',
  label: 'Fire damage',
  formula: '(@spell.casterLevel)d6',
  target: { mode: 'selected' },
  save: { outcome: 'half', notes: 'Save for half damage.' },
  attack: { mode: 'none', notes: '' },
  effect: { reference: '' },
  notes: ''
};

test('normalizes a bounded action without sharing nested defaults', () => {
  const first = normalizeSpellAction({ kind: 'manual', label: 'Adjudicate' }, {
    generateId: () => 'first-action'
  });
  const second = normalizeSpellAction({ kind: 'manual', label: 'Review' }, {
    generateId: () => 'second-action'
  });

  assert.equal(first.id, 'first-action');
  assert.equal(first.formula, '');
  assert.deepEqual(first.target, { mode: 'none' });
  assert.deepEqual(first.save, { outcome: 'none', notes: '' });
  first.target.mode = 'manual';
  assert.equal(second.target.mode, 'none');
});

test('rejects unknown fields, invalid choices, missing formulas, and excess actions', () => {
  assert.throws(
    () => normalizeSpellAction({ kind: 'manual', label: 'X', unexpected: true }),
    (error) => error instanceof SpellValidationError && error.code === 'UNKNOWN_FIELD'
  );
  assert.throws(
    () => normalizeSpellAction({ id: 'blast', kind: 'blast', label: 'X' }),
    (error) => error.code === 'INVALID_ACTION_KIND'
  );
  assert.throws(
    () => normalizeSpellAction({ id: 'damage', kind: 'damage', label: 'X', formula: ' ' }),
    (error) => error.code === 'FORMULA_REQUIRED'
  );
  assert.throws(
    () => normalizeSpellActions(Array.from({ length: 33 }, (_, index) => ({
      id: `action-${index}`,
      kind: 'manual',
      label: `Action ${index}`
    }))),
    (error) => error.code === 'TOO_MANY_ACTIONS'
  );
});

test('requires unique stable action IDs and preserves action order', () => {
  const actions = normalizeSpellActions([
    { id: 'first', kind: 'manual', label: 'First' },
    { id: 'second', kind: 'manual', label: 'Second' }
  ]);
  assert.deepEqual(actions.map((action) => action.id), ['first', 'second']);
  assert.throws(
    () => normalizeSpellActions([
      { id: 'same', kind: 'manual', label: 'First' },
      { id: 'same', kind: 'manual', label: 'Second' }
    ]),
    (error) => error.code === 'DUPLICATE_ACTION_ID'
  );
});

test('allows only documented @spell formula paths', () => {
  assert.deepEqual(validateFormulaReferences('1d6 + @spell.casterLevel'), [
    'spell.casterLevel'
  ]);
  assert.throws(
    () => validateFormulaReferences('@lvl + @actor.system.hp.value'),
    (error) => error.code === 'UNSUPPORTED_FORMULA_REFERENCE'
  );
  assert.throws(
    () => validateFormulaReferences('1d6 + @spell.unknown'),
    (error) => error.code === 'UNSUPPORTED_FORMULA_REFERENCE'
  );
});

test('resolves caster level only from the explicitly selected source', () => {
  assert.deepEqual(resolveCasterLevel({ levelSource: 'automatic' }, {
    type: 'character', system: { level: { value: '7' } }
  }), { status: 'resolved', source: 'automatic', value: 7 });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'automatic' }, {
    type: 'npc', system: { hd: '6+1', cl: '14' }
  }), { status: 'resolved', source: 'automatic', value: 6 });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'automatic' }, {
    type: 'character', system: { level: { value: '7/5' } }
  }), { status: 'prompt', source: 'automatic', reason: 'AUTOMATIC_REQUIRES_PROMPT' });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'fixed', fixedLevel: 8 }, null), {
    status: 'resolved', source: 'fixed', value: 8
  });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'characterLevel' }, {
    type: 'character', system: { level: { value: '5' } }
  }), { status: 'resolved', source: 'characterLevel', value: 5 });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'characterLevel' }, {
    type: 'character', system: { level: { value: '5/4' } }
  }), { status: 'prompt', source: 'characterLevel', reason: 'AMBIGUOUS_CHARACTER_LEVEL' });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'npcHitDice' }, {
    type: 'npc', system: { hd: '4+2', cl: '7' }
  }), { status: 'resolved', source: 'npcHitDice', value: 4 });

  assert.deepEqual(resolveCasterLevel({ levelSource: 'prompt' }, {
    type: 'npc', system: { hd: '22', cl: '30' }
  }), { status: 'prompt', source: 'prompt', reason: 'PROMPT_REQUIRED' });
});

test('builds only the namespaced spell roll context', () => {
  assert.deepEqual(createSpellRollData({
    spellLevel: 3,
    casterLevel: 7,
    abilityModifier: null
  }), {
    spell: { level: 3, casterLevel: 7, abilityModifier: null }
  });
});

test('creates deterministic action fingerprints and immutable snapshots', () => {
  const firstFingerprint = fingerprintAction(damageAction);
  const reordered = {
    notes: '',
    effect: { reference: '' },
    attack: { notes: '', mode: 'none' },
    save: { notes: 'Save for half damage.', outcome: 'half' },
    target: { mode: 'selected' },
    formula: '(@spell.casterLevel)d6',
    label: 'Fire damage',
    kind: 'damage',
    id: 'action-damage'
  };
  assert.equal(fingerprintAction(reordered), firstFingerprint);

  const item = {
    uuid: 'Actor.actor-1.Item.spell-1',
    name: 'Fireball',
    img: 'fireball.svg',
    system: {
      description: '<p>A bright explosion.</p>',
      spellLevel: 3,
      range: '240 feet',
      duration: 'Instantaneous',
      actions: [damageAction]
    }
  };
  const snapshot = buildSpellMessageSnapshot({
    item,
    caster: { uuid: 'Actor.actor-1', name: 'Merlin' },
    casting: { casterLevel: 5, source: 'fixed' },
    targetUuids: ['Scene.scene-1.Token.token-1']
  });
  item.name = 'Changed later';
  item.system.actions[0].label = 'Changed later';

  assert.equal(snapshot.item.name, 'Fireball');
  assert.equal(snapshot.actions[0].label, 'Fire damage');
  assert.deepEqual(snapshot.targetUuids, ['Scene.scene-1.Token.token-1']);
  assert.equal(snapshot.schemaVersion, SPELL_MESSAGE_SCHEMA_VERSION);
});

test('plans an action from the snapshot rather than live targets', () => {
  const action = normalizeSpellAction(damageAction);
  const plan = planSpellAction({
    action,
    spellLevel: 3,
    casterLevel: 6,
    targetUuids: ['Scene.scene-1.Token.token-a', 'Scene.scene-1.Token.token-b']
  });
  assert.equal(plan.kind, 'damage');
  assert.equal(plan.formula, '(@spell.casterLevel)d6');
  assert.deepEqual(plan.rollData, {
    spell: { level: 3, casterLevel: 6, abilityModifier: null }
  });
  assert.deepEqual(plan.targetUuids, [
    'Scene.scene-1.Token.token-a',
    'Scene.scene-1.Token.token-b'
  ]);
});

test('does not silently coerce an unavailable ability modifier', () => {
  const action = normalizeSpellAction({
    id: 'ability-roll',
    kind: 'roll',
    label: 'Ability roll',
    formula: '1d20 + @spell.abilityModifier'
  });
  assert.throws(() => planSpellAction({
    action,
    spellLevel: 1,
    casterLevel: 3,
    abilityModifier: null,
    targetUuids: []
  }), (error) => error.code === 'ABILITY_MODIFIER_REQUIRED');
});

test('consumes exactly one prepared occurrence without mutating the input', () => {
  const prepared = ['spell-a', 'spell-b', 'spell-a'];
  assert.deepEqual(consumePreparedSpell(prepared, 'spell-a'), {
    status: 'consumed',
    index: 0,
    prepared: ['spell-b', 'spell-a']
  });
  assert.deepEqual(prepared, ['spell-a', 'spell-b', 'spell-a']);
  assert.deepEqual(consumePreparedSpell(prepared, 'missing'), {
    status: 'missing',
    index: -1,
    prepared
  });
});
