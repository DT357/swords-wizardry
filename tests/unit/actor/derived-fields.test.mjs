import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DerivedFieldValidationError,
  synchronizeDerivedFields
} from '../../../module/actor/derived-fields.mjs';

const current = {
  tHAACB: 0,
  tHAC0: 19,
  ac: { value: 9 },
  aac: { value: 10 }
};

test('one supplied derived field updates its counterpart including zero', () => {
  const changed = { tHAC0: 0 };
  synchronizeDerivedFields(current, changed);
  assert.deepEqual(changed, { tHAC0: 0, tHAACB: 19 });

  const armor = { aac: { value: 19 } };
  synchronizeDerivedFields(current, armor);
  assert.deepEqual(armor, { aac: { value: 19 }, ac: { value: 0 } });
});

test('consistent simultaneous values are accepted and inconsistent API updates fail', () => {
  assert.doesNotThrow(() => synchronizeDerivedFields(current, {
    tHAC0: 14, tHAACB: 5, ac: { value: 3 }, aac: { value: 16 }
  }));
  assert.throws(() => synchronizeDerivedFields(current, {
    tHAC0: 14, tHAACB: 7
  }), DerivedFieldValidationError);
  assert.throws(() => synchronizeDerivedFields(current, {
    ac: { value: 3 }, aac: { value: 12 }
  }), DerivedFieldValidationError);
});

test('sheet changed-field option chooses the edited side of a full form', () => {
  const attack = { tHAC0: 19, tHAACB: 4 };
  synchronizeDerivedFields(current, attack, {
    swordsWizardry: { changedField: 'system.tHAACB' }
  });
  assert.deepEqual(attack, { tHAC0: 15, tHAACB: 4 });

  const armor = { ac: { value: 9 }, aac: { value: 14 } };
  synchronizeDerivedFields(current, armor, {
    swordsWizardry: { changedField: 'system.aac.value' }
  });
  assert.deepEqual(armor, { ac: { value: 5 }, aac: { value: 14 } });
});
