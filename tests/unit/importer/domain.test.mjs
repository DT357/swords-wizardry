import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNpcStatBlock } from '../../../module/importer/domain.mjs';

const VALID = 'Giant Worker Ant: HD 2; AC 3[16]; Atk bite (1d6), sting (1d4 + 1); Move 18; Save 16; Morale 10; AL N; CL/XP 2/30; Special: immune to sleep.';

test('parser produces one immutable Actor source with embedded attacks', () => {
  const result = parseNpcStatBlock(VALID);
  assert.equal(result.status, 'success');
  assert.equal(result.plan.actor.name, 'Giant Worker Ant');
  assert.equal(result.plan.actor.system.hd, '2d8');
  assert.equal(result.plan.actor.system.ac.value, 3);
  assert.equal(result.plan.actor.system.aac.value, 16);
  assert.equal(result.plan.actor.system.cl, '2');
  assert.equal(result.plan.actor.system.xp.value, 30);
  assert.deepEqual(result.plan.actor.items.map((item) => [item.name, item.system.damageFormula]), [
    ['bite', '1d6'],
    ['sting', '1d4 + 1']
  ]);
  assert.equal(Object.isFrozen(result.plan.actor.items[0]), true);
});

test('known labels are case-insensitive and unknown segments are preserved diagnostically', () => {
  const result = parseNpcStatBlock(
    'Rat King: hit dice 3+1; ac 6; attack bite (1d3); mv 12; sv 14; ml 8; al C; cl/xp 3/60; Habitat sewer; Special none'
  );
  assert.equal(result.status, 'success');
  assert.equal(result.plan.actor.system.hd, '3d8 + 1');
  assert.match(result.plan.diagnostics.unknownText, /Habitat sewer/i);
});

test('malformed attacks, CL/XP, HD, missing fields, and oversized input fail completely', () => {
  const variants = [
    VALID.replace('bite (1d6), sting (1d4 + 1)', 'bite 1d6'),
    VALID.replace('2/30', 'two/thirty'),
    VALID.replace('HD 2', 'HD 0'),
    VALID.replace(/; Atk[^;]+/, ''),
    `Monster: ${'x'.repeat(20_001)}`
  ];
  for (const source of variants) {
    const result = parseNpcStatBlock(source);
    assert.equal(result.status, 'failure');
    assert.equal('plan' in result, false);
    assert.equal(result.errors.length > 0, true);
  }
});

test('attack parser splits only complete Name (formula) groups', () => {
  const result = parseNpcStatBlock(VALID.replace(
    'bite (1d6), sting (1d4 + 1)',
    '2 claws (1d4), bite and hold (1d8 + 2)'
  ));
  assert.equal(result.status, 'success');
  assert.deepEqual(result.plan.actor.items.map((item) => item.name), [
    '2 claws', 'bite and hold'
  ]);
});
