import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionsFromFormData,
  effectEditorVisibility,
  moveAction
} from '../../../module/spells/editor-state.mjs';

test('shows only fields relevant to each spell effect type', () => {
  assert.deepEqual(effectEditorVisibility('damage', { saveOutcome: 'half' }), {
    formula: true,
    target: true,
    save: true,
    saveNotes: true,
    attack: false,
    attackNotes: false,
    reference: false,
    notes: false
  });
  assert.deepEqual(effectEditorVisibility('healing'), {
    formula: true,
    target: true,
    save: false,
    saveNotes: false,
    attack: false,
    attackNotes: false,
    reference: false,
    notes: false
  });
  assert.deepEqual(effectEditorVisibility('attack', { attackMode: 'custom' }), {
    formula: true,
    target: true,
    save: false,
    saveNotes: false,
    attack: true,
    attackNotes: true,
    reference: false,
    notes: false
  });
  assert.deepEqual(effectEditorVisibility('roll'), {
    formula: true,
    target: true,
    save: false,
    saveNotes: false,
    attack: false,
    attackNotes: false,
    reference: false,
    notes: false
  });
  assert.deepEqual(effectEditorVisibility('effect'), {
    formula: false,
    target: true,
    save: true,
    saveNotes: false,
    attack: false,
    attackNotes: false,
    reference: true,
    notes: true
  });
  assert.deepEqual(effectEditorVisibility('manual'), {
    formula: false,
    target: true,
    save: false,
    saveNotes: false,
    attack: false,
    attackNotes: false,
    reference: false,
    notes: true
  });
  assert.throws(() => effectEditorVisibility('unknown'), /Unknown spell effect type/);
});

test('reconstructs ordered action rows from FormDataExtended output', () => {
  const actions = actionsFromFormData({
    1: { id: 'second', kind: 'manual', label: 'Second' },
    0: { id: 'first', kind: 'manual', label: 'First' }
  });
  assert.deepEqual(actions.map((action) => action.id), ['first', 'second']);
});

test('moves one action without mutating the source and clamps boundaries', () => {
  const source = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(moveAction(source, 1, -1).map((action) => action.id), ['b', 'a', 'c']);
  assert.deepEqual(moveAction(source, 0, -1), source);
  assert.deepEqual(moveAction(source, 2, 1), source);
  assert.deepEqual(source.map((action) => action.id), ['a', 'b', 'c']);
});

test('rejects malformed form action collections', () => {
  assert.deepEqual(actionsFromFormData(undefined), []);
  assert.throws(() => actionsFromFormData('not-an-object'), /Invalid action form data/);
});
