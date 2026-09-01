import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WeaponValidationError,
  buildWeaponPlan,
  fingerprintWeaponPlan
} from '../../../module/weapons/domain.mjs';

function sources({ ascending = true } = {}) {
  return {
    useAscendingAC: ascending,
    actor: {
      uuid: 'Actor.attacker1',
      system: {
        tHAACB: 2,
        tHAC0: 18,
        modifiers: {
          toHit: { value: 1, v: 1 },
          missileToHit: { value: 3, v: 3 },
          damage: { value: 2, v: 2 }
        }
      }
    },
    item: {
      uuid: 'Actor.attacker1.Item.weapon1',
      type: 'weapon',
      system: {
        modifier: 1,
        missile: true,
        damageFormula: '1d6',
        specialDamage: 'silver'
      }
    }
  };
}

test('weapon plan builds validated attack and damage formulas from live sources', () => {
  const plan = buildWeaponPlan(sources());
  assert.equal(plan.attackFormula, '1d20 + 2 + 1 + 3 + 1');
  assert.equal(plan.damageFormula, '1d6 + 2');
  assert.equal(plan.attackMode, 'missile');
  assert.equal(plan.specialDamage, 'silver');
  assert.equal(Object.isFrozen(plan), true);
});

test('descending attacks omit ascending bonus but preserve other modifiers', () => {
  const plan = buildWeaponPlan(sources({ ascending: false }));
  assert.equal(plan.attackFormula, '1d20 + 1 + 3 + 1');
});

test('weapon plans reject invalid source types, formulas, and modifiers', () => {
  const badType = sources();
  badType.item.type = 'spell';
  assert.throws(() => buildWeaponPlan(badType), WeaponValidationError);

  const badFormula = sources();
  badFormula.item.system.damageFormula = '';
  assert.throws(() => buildWeaponPlan(badFormula), WeaponValidationError);

  const badModifier = sources();
  badModifier.item.system.modifier = Number.POSITIVE_INFINITY;
  assert.throws(() => buildWeaponPlan(badModifier), WeaponValidationError);
});

test('weapon plan fingerprint changes with relevant live data only', () => {
  const first = buildWeaponPlan(sources());
  const second = buildWeaponPlan(sources());
  assert.equal(fingerprintWeaponPlan(first), fingerprintWeaponPlan(second));
  assert.notEqual(
    fingerprintWeaponPlan(first),
    fingerprintWeaponPlan({ ...second, damageFormula: '1d8 + 2' })
  );
});
