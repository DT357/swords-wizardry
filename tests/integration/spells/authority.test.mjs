import assert from 'node:assert/strict';
import test from 'node:test';

import { SpellService } from '../../../module/spells/service.mjs';

function fixture({ dmAppliesDamage = true } = {}) {
  const users = new Map([
    ['player1', { id: 'player1', isGM: false }],
    ['gm1', { id: 'gm1', isGM: true }]
  ]);
  let currentUser = { ...users.get('player1'), isActiveGM: false };
  const actor = {
    id: 'caster1',
    uuid: 'Actor.caster1',
    name: 'Caster',
    type: 'character',
    isOwner: true,
    system: {
      level: { value: 4 },
      spellSlots: { 2: { memorized: ['spell1'] } },
      ac: { value: 9 },
      aac: { value: 10 }
    },
    updates: [],
    testUserPermission(user, permission) {
      return permission === 'OWNER' && (user.id === 'player1' || user.isGM);
    },
    async update(changes) {
      this.updates.push(structuredClone(changes));
      if (changes['system.spellSlots.2.memorized']) {
        this.system.spellSlots[2].memorized = [
          ...changes['system.spellSlots.2.memorized']
        ];
      }
      return this;
    }
  };
  const item = {
    id: 'spell1',
    _id: 'spell1',
    uuid: 'Actor.caster1.Item.spell1',
    name: 'Burning Hands',
    img: 'spell.svg',
    type: 'spell',
    isOwner: true,
    actor,
    parent: actor,
    testUserPermission(user, permission) {
      return permission === 'OWNER' && (user.id === 'player1' || user.isGM);
    },
    system: {
      description: 'Fire.',
      spellLevel: 2,
      range: '15 feet',
      duration: 'Instantaneous',
      casting: { levelSource: 'fixed', fixedLevel: 4 },
      actions: [{
        id: 'damage',
        kind: 'damage',
        label: 'Damage',
        formula: '(@spell.casterLevel)d6',
        target: { mode: 'selected' },
        save: { outcome: 'none', notes: '' },
        attack: { mode: 'none', notes: '' },
        effect: { reference: '' },
        notes: ''
      }]
    }
  };
  const target = {
    id: 'target1',
    uuid: 'Actor.target1',
    documentName: 'Actor',
    name: 'Target',
    system: { hp: { value: 10, max: 10 }, ac: { value: 9 }, aac: { value: 10 } }
  };
  const documents = new Map([
    [actor.uuid, actor], [item.uuid, item], [target.uuid, target]
  ]);
  const messages = [];
  const authorityCalls = [];
  const hpCalls = [];
  let service;
  const authority = {
    hasActiveGM: () => true,
    async request(operation, payload) {
      authorityCalls.push({ operation, payload: structuredClone(payload) });
      return { status: 'success', code: null };
    }
  };
  const deps = {
    resolveUuid: async (uuid) => documents.get(uuid) ?? null,
    enrichHTML: async (html) => html,
    renderTemplate: async (path, context) => JSON.stringify({ path, context }),
    async createChatMessage(data) {
      const message = {
        id: `message${messages.length + 1}`,
        uuid: `ChatMessage.message${messages.length + 1}`,
        author: users.get(currentUser.id),
        ...structuredClone(data),
        getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
        async update(changes) {
          for (const [path, value] of Object.entries(changes)) {
            if (path === 'flags.swords-wizardry.spell') {
              this.flags['swords-wizardry'].spell = structuredClone(value);
            }
          }
          return this;
        }
      };
      messages.push(message);
      documents.set(message.uuid, message);
      return message;
    },
    async evaluateRoll(formula, data) {
      return {
        formula, data, total: 8,
        roll: { formula, total: 8 },
        html: '<div>8</div>'
      };
    },
    async promptCasterLevel() { return 4; },
    getSelectedTargetUuids: () => [target.uuid],
    getRollMode: () => 'publicroll',
    getSpeaker: ({ actor: source }) => ({ actor: source?.id }),
    getCurrentUser: () => currentUser,
    getUserById: (id) => users.get(id) ?? null,
    localize: (key) => key,
    notify() {},
    useAscendingAC: () => false,
    randomId: () => 'consume_12345678',
    authority,
    hitPointService: {
      async applyAuthorized(request) {
        hpCalls.push(structuredClone(request));
        return { status: 'success', code: null };
      }
    },
    dmAppliesDamage: () => dmAppliesDamage
  };
  service = new SpellService(deps);
  return {
    actor, item, target, documents, messages, authority, authorityCalls, hpCalls,
    service,
    setCurrentUser(id, isActiveGM = id === 'gm1') {
      currentUser = { ...users.get(id), isActiveGM };
    },
    useRealAuthorityHandlers() {
      authority.request = async (operation, payload) => {
        authorityCalls.push({ operation, payload: structuredClone(payload) });
        const prior = currentUser;
        currentUser = { ...users.get('gm1'), isActiveGM: true };
        try {
          if (operation === 'spell.consume') {
            return await service.handleConsume({ senderUserId: prior.id, payload });
          }
          if (operation === 'spell.hitPointResult') {
            return await service.handleHitPointResult({ senderUserId: prior.id, payload });
          }
          throw new Error(`unexpected operation ${operation}`);
        } finally {
          currentUser = prior;
        }
      };
    }
  };
}

test('HP spell invocation sends only bounded references to authority', async () => {
  const state = fixture();
  const posted = await state.service.post(state.item);
  const result = await state.service.invoke(posted.message.uuid, 'damage', {
    targetUuids: [state.target.uuid]
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(state.authorityCalls, [{
    operation: 'spell.hitPointResult',
    payload: {
      messageUuid: posted.message.uuid,
      actionId: 'damage',
      targetUuids: [state.target.uuid],
      rollMode: 'publicroll'
    }
  }]);
  assert.equal(state.messages.length, 1);
});

test('active GM re-resolves the spell and creates the authoritative HP result', async () => {
  const state = fixture({ dmAppliesDamage: false });
  state.useRealAuthorityHandlers();
  const posted = await state.service.post(state.item);
  const result = await state.service.invoke(posted.message.uuid, 'damage', {
    targetUuids: [state.target.uuid]
  });

  assert.equal(result.status, 'success');
  assert.equal(state.messages.length, 2);
  const message = state.messages[1];
  assert.equal(message.author.id, 'gm1');
  const flags = message.flags['swords-wizardry'].spell;
  assert.equal(flags.requestedBy, 'player1');
  assert.equal(flags.messageKind, 'spell-result');
  assert.deepEqual(flags.targetUuids, [state.target.uuid]);
  assert.equal(state.hpCalls.length, 1);
  assert.equal(state.hpCalls[0].mode, 'fullDamage');
});

test('active GM rejects source changes and forged message authors before rolling', async () => {
  const state = fixture();
  const posted = await state.service.post(state.item);
  state.setCurrentUser('gm1');
  state.item.system.actions[0].formula = '99d99';
  const stale = await state.service.handleHitPointResult({
    senderUserId: 'player1',
    payload: {
      messageUuid: posted.message.uuid,
      actionId: 'damage',
      targetUuids: [state.target.uuid],
      rollMode: 'publicroll'
    }
  });
  assert.equal(stale.code, 'STALE_SOURCE');
  assert.equal(state.messages.length, 1);

  state.item.system.actions[0].formula = '(@spell.casterLevel)d6';
  posted.message.author = { id: 'other-player', isGM: false };
  const forged = await state.service.handleHitPointResult({
    senderUserId: 'player1',
    payload: {
      messageUuid: posted.message.uuid,
      actionId: 'damage',
      targetUuids: [state.target.uuid],
      rollMode: 'publicroll'
    }
  });
  assert.equal(forged.code, 'NOT_AUTHORIZED');
});

test('cast consumption is planned and executed by the active GM', async () => {
  const state = fixture();
  state.useRealAuthorityHandlers();
  const result = await state.service.cast(state.item);

  assert.equal(result.status, 'success');
  assert.deepEqual(state.actor.system.spellSlots[2].memorized, []);
  assert.equal(state.actor.updates.length, 1);
  const flags = state.messages[0].flags['swords-wizardry'].spell;
  assert.equal(flags.consumption.status, 'consumed');
  assert.equal(flags.consumption.requestId, 'consume_12345678');
});
