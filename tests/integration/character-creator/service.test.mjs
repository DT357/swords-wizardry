import assert from 'node:assert/strict';
import test from 'node:test';

import { CharacterCreationService } from '../../../module/character-creator/service.mjs';

function fixture(overrides = {}) {
  const creates = [];
  let total = 10;
  const folder = { id: 'folder1', type: 'Actor', visible: true };
  const service = new CharacterCreationService({
    getCurrentUser: () => ({ id: 'player1', can: (permission) => permission === 'ACTOR_CREATE' }),
    getFolderById: (id) => id === folder.id ? folder : null,
    evaluateRoll: async () => ({ total: total += 1 }),
    createActor: async (source) => { creates.push(structuredClone(source)); return source; },
    ownershipLevels: { none: 0, owner: 3 },
    ...overrides
  });
  return { service, creates };
}

test('permitted user creates one owned Actor in an allowed Actor folder', async () => {
  const { service, creates } = fixture();
  const result = await service.create({ name: ' Alice ', folderId: 'folder1' });
  assert.equal(result.status, 'success');
  assert.equal(creates.length, 1);
  assert.equal(creates[0].name, 'Alice');
  assert.deepEqual(creates[0].ownership, { default: 0, player1: 3 });
});

test('denied user and invalid folder fail before rolls or Actor creation', async () => {
  let rolls = 0;
  const denied = fixture({
    getCurrentUser: () => ({ id: 'player1', can: () => false }),
    evaluateRoll: async () => { rolls += 1; return { total: 10 }; }
  });
  assert.equal((await denied.service.create({ name: 'Alice' })).code, 'NOT_AUTHORIZED');
  assert.equal(rolls, 0);
  assert.equal(denied.creates.length, 0);

  const invalid = fixture();
  assert.equal((await invalid.service.create({ name: 'Alice', folderId: 'missing' })).code, 'INVALID_FOLDER');
  assert.equal(invalid.creates.length, 0);
});

test('roll or create failure creates no partial Actor and service remains reusable', async () => {
  const rollFailure = fixture({ evaluateRoll: async () => { throw new Error('dice'); } });
  assert.equal((await rollFailure.service.create({ name: 'Alice' })).code, 'ROLL_FAILED');
  assert.equal(rollFailure.creates.length, 0);

  let attempts = 0;
  const createFailure = fixture({
    createActor: async () => { attempts += 1; throw new Error('create'); }
  });
  assert.equal((await createFailure.service.create({ name: 'Alice' })).code, 'ACTOR_CREATE_FAILED');
  assert.equal((await createFailure.service.create({ name: 'Alice' })).code, 'ACTOR_CREATE_FAILED');
  assert.equal(attempts, 2);
});

test('repeat submit is blocked while a creation is pending', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { service } = fixture({ createActor: async (source) => { await pending; return source; } });
  const first = service.create({ name: 'Alice' });
  assert.equal((await service.create({ name: 'Bob' })).code, 'CREATION_IN_PROGRESS');
  release();
  assert.equal((await first).status, 'success');
});
