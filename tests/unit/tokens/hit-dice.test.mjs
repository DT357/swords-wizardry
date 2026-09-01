import assert from 'node:assert/strict';
import test from 'node:test';

import { HitDiceValidationError, parseHitDice } from '../../../module/tokens/hit-dice.mjs';

test('hit dice parser accepts bare dice counts, dice faces, and one modifier', () => {
  assert.deepEqual(parseHitDice('3'), {
    dice: 3, faces: 8, modifier: 0, formula: '3d8'
  });
  assert.deepEqual(parseHitDice(' 2d6 + 3 '), {
    dice: 2, faces: 6, modifier: 3, formula: '2d6 + 3'
  });
  assert.deepEqual(parseHitDice('4-2'), {
    dice: 4, faces: 8, modifier: -2, formula: '4d8 - 2'
  });
});

test('hit dice parser rejects unsafe or expanded roll grammar', () => {
  for (const value of [
    '', '0', '-1', '1d0', '1.5', '2d6+1+2', '2d6kh1', '2d6 damage',
    `${Number.MAX_SAFE_INTEGER}0d8`
  ]) {
    assert.throws(() => parseHitDice(value), HitDiceValidationError, value);
  }
});
