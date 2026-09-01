import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RollValidationError,
  evaluateThreshold,
  normalizeFeatureFormula,
  normalizeRollMode
} from '../../../module/rolls/domain.mjs';

test('blank feature formulas are explicitly description-only', () => {
  assert.equal(normalizeFeatureFormula(''), null);
  assert.equal(normalizeFeatureFormula('  \r\n '), null);
  assert.equal(normalizeFeatureFormula(' 1d6 + 2 '), '1d6 + 2');
});

test('feature threshold evaluation supports ascending and descending checks', () => {
  assert.deepEqual(evaluateThreshold({ total: 12, target: 12, targetType: 'ascending' }), {
    target: 12, targetType: 'ascending', success: true
  });
  assert.deepEqual(evaluateThreshold({ total: 7, target: 6, targetType: 'descending' }), {
    target: 6, targetType: 'descending', success: false
  });
});

test('roll domain rejects invalid formulas, modes, totals, and thresholds', () => {
  assert.throws(() => normalizeFeatureFormula('x'.repeat(201)), RollValidationError);
  assert.throws(
    () => evaluateThreshold({ total: Number.NaN, target: 1, targetType: 'ascending' }),
    RollValidationError
  );
  assert.throws(
    () => evaluateThreshold({ total: 1, target: 1, targetType: 'other' }),
    RollValidationError
  );
  assert.throws(() => normalizeRollMode('secret'), RollValidationError);
});

test('roll modes normalize legacy and v14 spellings to canonical settings values', () => {
  assert.equal(normalizeRollMode('public'), 'publicroll');
  assert.equal(normalizeRollMode('gm'), 'gmroll');
  assert.equal(normalizeRollMode('blindroll'), 'blindroll');
  assert.equal(normalizeRollMode('self'), 'selfroll');
});
