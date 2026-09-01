import assert from 'node:assert/strict';
import test from 'node:test';

import { SPELL_MESSAGE_SCHEMA_VERSION } from '../../../module/spells/constants.mjs';
import { readHitPointCapability } from '../../../module/hit-points/result-adapters.mjs';

function spellMessage({ authorIsGM = true, authorId = 'gm1' } = {}) {
  return {
    uuid: 'ChatMessage.spellResult1',
    author: { id: authorId, isGM: authorIsGM },
    flags: {
      'swords-wizardry': {
        spell: {
          schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION,
          messageKind: 'spell-result',
          requestedBy: 'player1',
          sourceActorUuid: 'Actor.caster1',
          sourceItemUuid: 'Actor.caster1.Item.spell1',
          action: { id: 'damage', kind: 'damage', fingerprint: 'abc123' },
          targetUuids: ['Actor.target1'],
          result: { total: 6 }
        }
      }
    }
  };
}

test('spell result adapter accepts only GM-authored current-schema HP results', async () => {
  const message = spellMessage();
  const capability = await readHitPointCapability(message, {
    getUserById: (id) => message.author.id === id ? message.author : null
  });
  assert.equal(capability.sourceKind, 'spell');
  assert.equal(capability.amount, 6);
  assert.deepEqual(Object.keys(capability.modes), [
    'fullDamage', 'halfDamage', 'doubleDamage'
  ]);

  assert.equal(await readHitPointCapability(spellMessage({ authorIsGM: false }), {
    getUserById: () => ({ id: 'player1', isGM: false })
  }), null);
});

test('healing spell results expose only healing mode', async () => {
  const message = spellMessage();
  message.flags['swords-wizardry'].spell.action.kind = 'healing';
  const capability = await readHitPointCapability(message, {
    getUserById: () => message.author
  });
  assert.deepEqual(capability.modes, {
    healing: { kind: 'healing', multiplier: 1 }
  });
});

test('forged, stale, malformed, and non-HP spell results are rejected', async () => {
  const variants = [
    (flags) => { flags.schemaVersion += 1; },
    (flags) => { flags.messageKind = 'spell-card'; },
    (flags) => { flags.action.kind = 'manual'; },
    (flags) => { flags.result.total = Number.POSITIVE_INFINITY; },
    (flags) => { flags.targetUuids = ['not-a-uuid']; },
    (flags) => { flags.requestedBy = ''; }
  ];
  for (const mutate of variants) {
    const message = spellMessage();
    mutate(message.flags['swords-wizardry'].spell);
    assert.equal(await readHitPointCapability(message, {
      getUserById: () => message.author
    }), null);
  }
});

test('weapon result adapter preserves four manual modes', async () => {
  const message = {
    uuid: 'ChatMessage.weaponResult1',
    author: { id: 'gm1', isGM: true },
    flags: {
      'swords-wizardry': {
        weapon: {
          schemaVersion: 1,
          messageKind: 'weapon-damage',
          requestedBy: 'player1',
          sourceActorUuid: 'Actor.attacker1',
          sourceItemUuid: 'Actor.attacker1.Item.weapon1',
          actionId: 'weapon-damage',
          actionFingerprint: 'abc123',
          targetUuids: ['Actor.target1'],
          result: { total: 4 }
        }
      }
    }
  };
  const capability = await readHitPointCapability(message, {
    getUserById: () => message.author
  });
  assert.equal(capability.sourceKind, 'weapon');
  assert.deepEqual(Object.keys(capability.modes), [
    'fullDamage', 'halfDamage', 'doubleDamage', 'healing'
  ]);
});
