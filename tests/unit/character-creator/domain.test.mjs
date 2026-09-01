import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CharacterCreationValidationError,
  buildCharacterSource
} from '../../../module/character-creator/domain.mjs';

test('character source trims name and gives only the creator explicit OWNER access', () => {
  const source = buildCharacterSource({
    name: '  Alice  ',
    folderId: 'folder1',
    userId: 'player1',
    ownershipLevels: { none: 0, owner: 3 },
    totals: { str: 12, dex: 11, con: 10, int: 9, wis: 8, cha: 7, gp: 13 }
  });
  assert.equal(source.name, 'Alice');
  assert.deepEqual(source.ownership, { default: 0, player1: 3 });
  assert.equal('permission' in source, false);
  assert.equal(source.system.treasure.gp, 130);
  assert.equal(source.img.startsWith('/'), false);
});

test('character source rejects missing names, unsafe totals, and invalid identity', () => {
  const base = {
    name: 'Alice', folderId: null, userId: 'player1',
    ownershipLevels: { none: 0, owner: 3 },
    totals: { str: 12, dex: 11, con: 10, int: 9, wis: 8, cha: 7, gp: 13 }
  };
  assert.throws(() => buildCharacterSource({ ...base, name: '  ' }), CharacterCreationValidationError);
  assert.throws(() => buildCharacterSource({ ...base, userId: '' }), CharacterCreationValidationError);
  assert.throws(() => buildCharacterSource({
    ...base, totals: { ...base.totals, str: Number.NaN }
  }), CharacterCreationValidationError);
});
