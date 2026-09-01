import assert from 'node:assert/strict';
import test from 'node:test';

import { ImportService } from '../../../module/importer/service.mjs';

const VALID = 'Giant Worker Ant: HD 2; AC 3[16]; Atk bite (1d6); Move 18; Save 16; Morale 10; AL N; CL/XP 2/30; Special: none.';

function fixture(overrides = {}) {
  const creates = [];
  const service = new ImportService({
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    validateRollFormula: () => true,
    createActor: async (source, options) => {
      creates.push([structuredClone(source), options]);
      return { uuid: 'Actor.imported', ...source };
    },
    ...overrides
  });
  return { service, creates };
}

test('valid import performs one atomic Actor create with embedded Items', async () => {
  const { service, creates } = fixture();
  const result = await service.import(VALID);
  assert.equal(result.status, 'success');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][0].items.length, 1);
  assert.equal(creates[0][0].items[0].type, 'weapon');
  assert.deepEqual(creates[0][1], { renderSheet: true });
});

test('permission, parse, and formula failures perform no Document writes', async () => {
  const denied = fixture({ getCurrentUser: () => ({ id: 'player1', isGM: false }) });
  assert.equal((await denied.service.import(VALID)).code, 'NOT_AUTHORIZED');
  assert.equal(denied.creates.length, 0);

  const malformed = fixture();
  assert.equal((await malformed.service.import('not a stat block')).code, 'INVALID_STAT_BLOCK');
  assert.equal(malformed.creates.length, 0);

  const invalidFormula = fixture({ validateRollFormula: () => false });
  assert.equal((await invalidFormula.service.import(VALID)).code, 'INVALID_ATTACK_FORMULA');
  assert.equal(invalidFormula.creates.length, 0);
});

test('Actor creation failure leaves the service reusable and reports one failure', async () => {
  let attempts = 0;
  const { service } = fixture({
    createActor: async () => { attempts += 1; throw new Error('create failed'); }
  });
  assert.equal((await service.import(VALID)).code, 'ACTOR_CREATE_FAILED');
  assert.equal((await service.import(VALID)).code, 'ACTOR_CREATE_FAILED');
  assert.equal(attempts, 2);
});

test('a repeated submission is rejected while the first create is pending', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { service } = fixture({
    createActor: async () => { await pending; return { uuid: 'Actor.imported' }; }
  });
  const first = service.import(VALID);
  assert.equal((await service.import(VALID)).code, 'IMPORT_IN_PROGRESS');
  release();
  assert.equal((await first).status, 'success');
});
