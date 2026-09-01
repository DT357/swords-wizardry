import assert from 'node:assert/strict';
import test from 'node:test';

import { WeaponService } from '../../../module/weapons/service.mjs';

function fixture({ dmAppliesDamage = true } = {}) {
  const users = new Map([
    ['player1', { id: 'player1', isGM: false }],
    ['gm1', { id: 'gm1', isGM: true }]
  ]);
  let currentUser = { ...users.get('gm1'), isActiveGM: true };
  const actor = {
    id: 'attacker1',
    uuid: 'Actor.attacker1',
    name: 'Fighter',
    system: {
      tHAACB: 2,
      tHAC0: 18,
      modifiers: {
        toHit: { value: 1, v: 1 },
        missileToHit: { value: 0, v: 0 },
        damage: { value: 2, v: 2 }
      }
    }
  };
  const item = {
    id: 'weapon1',
    uuid: 'Actor.attacker1.Item.weapon1',
    name: 'Sword',
    type: 'weapon',
    actor,
    parent: actor,
    system: {
      modifier: 1,
      missile: false,
      damageFormula: '1d6',
      specialDamage: ''
    },
    testUserPermission(user, permission) {
      return permission === 'OWNER' && (user.id === 'player1' || user.isGM);
    }
  };
  const hitTarget = {
    uuid: 'Scene.scene1.Token.hit',
    name: 'Hit',
    actor: {
      uuid: 'Scene.scene1.Token.hit.Actor.hit',
      system: { ac: { value: 9 }, aac: { value: 10 }, hp: { value: 10, max: 10 } }
    }
  };
  const missTarget = {
    uuid: 'Scene.scene1.Token.miss',
    name: 'Miss',
    actor: {
      uuid: 'Scene.scene1.Token.miss.Actor.miss',
      system: { ac: { value: -5 }, aac: { value: 24 }, hp: { value: 10, max: 10 } }
    }
  };
  const documents = new Map([
    [item.uuid, item], [actor.uuid, actor],
    [hitTarget.uuid, hitTarget], [missTarget.uuid, missTarget]
  ]);
  const messages = [];
  const hpCalls = [];
  const evaluations = [];
  const deps = {
    resolveUuid: async (uuid) => documents.get(uuid) ?? null,
    getCurrentUser: () => currentUser,
    getUserById: (id) => users.get(id) ?? null,
    getSpeaker: ({ actor: source }) => ({ actor: source.id }),
    useAscendingAC: () => true,
    dmAppliesDamage: () => dmAppliesDamage,
    async evaluateRoll(formula, data) {
      evaluations.push({ formula, data });
      const total = formula.startsWith('1d20') ? 12 : 5;
      return {
        formula, total,
        roll: { formula, total },
        html: `<div>${total}</div>`
      };
    },
    renderTemplate: async (path, context) => JSON.stringify({ path, context }),
    async createChatMessage(data) {
      const message = {
        uuid: `ChatMessage.message${messages.length + 1}`,
        author: users.get(currentUser.id),
        ...structuredClone(data)
      };
      messages.push(message);
      documents.set(message.uuid, message);
      return message;
    },
    hitPointService: {
      async applyAuthorized(request) {
        hpCalls.push(structuredClone(request));
        return { status: 'success', code: null };
      }
    }
  };
  const service = new WeaponService(deps);
  return {
    actor, item, hitTarget, missTarget, documents, messages, hpCalls, evaluations,
    service,
    setCurrentUser(id, isActiveGM = id === 'gm1') {
      currentUser = { ...users.get(id), isActiveGM };
    }
  };
}

test('active GM attack stores stable hit targets and source identity', async () => {
  const state = fixture();
  const result = await state.service.handleAttack({
    senderUserId: 'player1',
    payload: {
      itemUuid: state.item.uuid,
      targetUuids: [state.hitTarget.uuid, state.missTarget.uuid],
      rollMode: 'publicroll'
    }
  });
  assert.equal(result.status, 'success');
  const flags = state.messages[0].flags['swords-wizardry'].weapon;
  assert.equal(flags.messageKind, 'weapon-attack');
  assert.equal(flags.sourceItemUuid, state.item.uuid);
  assert.deepEqual(flags.hitTargetUuids, [state.hitTarget.uuid]);
  assert.deepEqual(flags.targetUuids, [state.hitTarget.uuid, state.missTarget.uuid]);
});

test('damage rolls only the trusted attack hit targets despite changed selection', async () => {
  const state = fixture();
  const attack = await state.service.handleAttack({
    senderUserId: 'player1',
    payload: {
      itemUuid: state.item.uuid,
      targetUuids: [state.hitTarget.uuid, state.missTarget.uuid],
      rollMode: 'publicroll'
    }
  });
  const damage = await state.service.handleDamage({
    senderUserId: 'player1',
    payload: { attackMessageUuid: attack.messageUuid }
  });
  assert.equal(damage.status, 'success');
  const flags = state.messages[1].flags['swords-wizardry'].weapon;
  assert.equal(flags.messageKind, 'weapon-damage');
  assert.deepEqual(flags.targetUuids, [state.hitTarget.uuid]);
  assert.equal(flags.result.total, 5);
});

test('automatic weapon damage applies exactly the trusted hit target', async () => {
  const state = fixture({ dmAppliesDamage: false });
  const attack = await state.service.handleAttack({
    senderUserId: 'player1',
    payload: {
      itemUuid: state.item.uuid,
      targetUuids: [state.hitTarget.uuid, state.missTarget.uuid],
      rollMode: 'publicroll'
    }
  });
  await state.service.handleDamage({
    senderUserId: 'player1',
    payload: { attackMessageUuid: attack.messageUuid }
  });
  assert.deepEqual(state.hpCalls.map((entry) => entry.targetUuid), [state.hitTarget.uuid]);
  assert.equal(state.hpCalls[0].mode, 'fullDamage');
});

test('forged attack authors, unauthorized items, and player-authored attack flags fail closed', async () => {
  const state = fixture();
  const denied = await state.service.handleAttack({
    senderUserId: 'unknown',
    payload: {
      itemUuid: state.item.uuid,
      targetUuids: [state.hitTarget.uuid],
      rollMode: 'publicroll'
    }
  });
  assert.equal(denied.code, 'NOT_AUTHORIZED');

  const attack = await state.service.handleAttack({
    senderUserId: 'player1',
    payload: {
      itemUuid: state.item.uuid,
      targetUuids: [state.hitTarget.uuid],
      rollMode: 'publicroll'
    }
  });
  state.messages[0].author = usersFallback('player1');
  const forged = await state.service.handleDamage({
    senderUserId: 'player1',
    payload: { attackMessageUuid: attack.messageUuid }
  });
  assert.equal(forged.code, 'INVALID_ATTACK_CAPABILITY');
  assert.equal(state.messages.length, 1);
});

function usersFallback(id) {
  return { id, isGM: false };
}
