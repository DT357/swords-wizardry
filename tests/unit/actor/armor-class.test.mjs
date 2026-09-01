import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateArmorClass,
  getEquippedArmorBonus,
  normalizeArmorClassSheetUpdate
} from '../../../module/actor/armor-class.mjs';

const armor = (effectOnAC, equipped = true) => ({
  type: 'armor',
  system: { effectOnAC, equipped }
});

test('only equipped armor contributes to the armor class bonus', () => {
  const items = [
    armor(2),
    armor(3, false),
    { type: 'weapon', system: { effectOnAC: 20, equipped: true } },
    { type: 'armor', system: { effectOnAC: 1 } }
  ];

  assert.equal(getEquippedArmorBonus(items), 3);
});

test('equipped armor improves descending and ascending armor class', () => {
  assert.deepEqual(calculateArmorClass({
    ac: { value: 9 },
    aac: { value: 10 }
  }, [armor(2)]), {
    ac: 7,
    aac: 12,
    bonus: 2
  });
});

test('sheet updates preserve base armor class and translate explicit AC edits', () => {
  const unrelatedUpdate = {
    name: 'Updated name',
    ac: { value: 7 },
    aac: { value: 12 }
  };
  normalizeArmorClassSheetUpdate(unrelatedUpdate, 2, {
    swordsWizardry: { changedField: 'name' }
  });
  assert.deepEqual(unrelatedUpdate, { name: 'Updated name' });

  const descendingEdit = {
    ac: { value: 6 },
    aac: { value: 12 }
  };
  normalizeArmorClassSheetUpdate(descendingEdit, 2, {
    swordsWizardry: { changedField: 'system.ac.value' }
  });
  assert.deepEqual(descendingEdit, { ac: { value: 8 } });

  const ascendingEdit = {
    ac: { value: 7 },
    aac: { value: 13 }
  };
  normalizeArmorClassSheetUpdate(ascendingEdit, 2, {
    swordsWizardry: { changedField: 'system.aac.value' }
  });
  assert.deepEqual(ascendingEdit, { aac: { value: 11 } });
});

test('API updates without sheet metadata continue to address base AC fields', () => {
  const changed = { ac: { value: 5 }, aac: { value: 14 } };
  normalizeArmorClassSheetUpdate(changed, 2);
  assert.deepEqual(changed, { ac: { value: 5 }, aac: { value: 14 } });
});
