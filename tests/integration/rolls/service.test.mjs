import assert from 'node:assert/strict';
import test from 'node:test';

import { RollService } from '../../../module/rolls/service.mjs';

function actorFixture(overrides = {}) {
  return {
    uuid: 'Actor.actor1',
    type: 'npc',
    name: 'Goblin',
    system: { save: { value: 14 }, morale: 7 },
    getRollData: () => ({ system: { save: { value: 14 }, morale: 7 } }),
    testUserPermission: () => true,
    ...overrides
  };
}

function itemFixture(overrides = {}) {
  const actor = actorFixture();
  return {
    uuid: 'Actor.actor1.Item.feature1',
    type: 'feature',
    name: 'Open Doors',
    img: 'feature.svg',
    actor,
    parent: actor,
    system: {
      formula: '1d6',
      target: 2,
      targetType: 'descending',
      description: '<p>Try the door.</p>'
    },
    ...overrides
  };
}

function dependencies(overrides = {}) {
  const messages = [];
  return {
    messages,
    service: new RollService({
      resolveUuid: async () => null,
      getCurrentUser: () => ({ id: 'gm1', isGM: true, isActiveGM: true }),
      getUserById: () => ({ id: 'player1', isGM: false }),
      getRollMode: () => 'publicroll',
      getSpeaker: ({ actor }) => ({ actor: actor.uuid }),
      evaluateRoll: async (formula, data) => ({
        formula,
        data,
        total: formula === '2d6' ? 6 : 2,
        roll: { formula },
        html: `<span>${formula}</span>`
      }),
      renderTemplate: async (template, context) => `${template}:${context.total ?? 'description'}`,
      enrichHTML: async (html) => `enriched:${html}`,
      createChatMessage: async (data) => { messages.push(data); return { uuid: 'ChatMessage.one' }; },
      authority: { request: async () => ({ status: 'success', code: null }) },
      ...overrides
    })
  };
}

test('save and formula feature rolls use the source Actor speaker', async () => {
  const { service, messages } = dependencies();
  const actor = actorFixture();
  const save = await service.save(actor);
  const feature = await service.feature(itemFixture());

  assert.equal(save.status, 'success');
  assert.equal(feature.status, 'success');
  assert.deepEqual(messages.map((message) => message.speaker), [
    { actor: 'Actor.actor1' },
    { actor: 'Actor.actor1' }
  ]);
  assert.equal(messages[1].content.endsWith(':2'), true);
});

test('ability rolls compare the evaluated total to the live score with equality succeeding', async () => {
  for (const [total, success] of [[11, true], [12, false]]) {
    const rendered = [];
    const { service, messages } = dependencies({
      evaluateRoll: async (formula, data) => ({
        formula,
        data,
        total,
        roll: { formula },
        html: `<span>${total}</span>`
      }),
      renderTemplate: async (template, context) => {
        rendered.push({ template, context });
        return 'ability-card';
      }
    });
    const actor = actorFixture({
      type: 'character',
      system: {
        abilities: { str: { value: 11, mod: 0 } },
        save: { value: 14 }
      },
      getRollData: () => ({ abilities: { str: { value: 11, mod: 0 } } })
    });

    const result = await service.ability(actor, 'str');

    assert.equal(result.status, 'success');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'ability-card');
    assert.equal(rendered[0].template.endsWith('/module/rolls/ability-roll-sheet.hbs'), true);
    assert.equal(rendered[0].context.total, total);
    assert.equal(rendered[0].context.target, 11);
    assert.equal(rendered[0].context.success, success);
    assert.equal(rendered[0].context.labelKey, 'SWORDS_WIZARDRY.Ability.Str.long');
  }
});

test('ability rolls reject unsupported attributes and unauthorized Actors before rolling', async () => {
  let evaluations = 0;
  const { service, messages } = dependencies({
    evaluateRoll: async () => { evaluations += 1; }
  });
  const actor = actorFixture({
    type: 'character',
    system: { abilities: { str: { value: 11, mod: 0 } } },
    getRollData: () => ({ abilities: { str: { value: 11, mod: 0 } } })
  });

  assert.equal((await service.ability(actor, 'luck')).code, 'INVALID_ABILITY');
  assert.equal((await service.ability({ ...actor, isOwner: false }, 'str')).code, 'NOT_AUTHORIZED');
  assert.equal(evaluations, 0);
  assert.equal(messages.length, 0);
});

test('blank feature formula posts one enriched description without recursion', async () => {
  const rendered = [];
  const { service, messages } = dependencies({
    renderTemplate: async (template, context) => {
      rendered.push({ template, context });
      return 'feature-card';
    }
  });
  const result = await service.feature(itemFixture({
    img: '',
    system: {
      formula: ' \n ', target: 2, targetType: 'descending', description: '<p>Only text.</p>'
    }
  }));

  assert.equal(result.status, 'success');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'feature-card');
  assert.deepEqual(messages[0].rolls, []);
  assert.equal(rendered[0].template.endsWith('/module/rolls/feature-roll-sheet.hbs'), true);
  assert.deepEqual(rendered[0].context, {
    item: {
      name: 'Open Doors',
      img: 'systems/swords-wizardry/assets/game-icons-net/skills.svg'
    },
    description: 'enriched:<p>Only text.</p>',
    roll: null
  });
});

test('formula feature card includes its icon, title, enriched description, and threshold result', async () => {
  const rendered = [];
  const { service, messages } = dependencies({
    renderTemplate: async (template, context) => {
      rendered.push({ template, context });
      return 'feature-card';
    }
  });

  const result = await service.feature(itemFixture());

  assert.equal(result.status, 'success');
  assert.equal(messages[0].content, 'feature-card');
  assert.equal(rendered[0].template.endsWith('/module/rolls/feature-roll-sheet.hbs'), true);
  assert.deepEqual(rendered[0].context.item, { name: 'Open Doors', img: 'feature.svg' });
  assert.equal(rendered[0].context.description, 'enriched:<p>Try the door.</p>');
  assert.equal(rendered[0].context.roll, '<span>1d6</span>');
  assert.equal(rendered[0].context.target, 2);
  assert.equal(rendered[0].context.targetType, 'descending');
  assert.equal(rendered[0].context.success, true);
});

test('invalid formulas produce a bounded failure and no message', async () => {
  const { service, messages } = dependencies({
    evaluateRoll: async () => { throw new Error('invalid formula'); }
  });
  const result = await service.feature(itemFixture());
  assert.deepEqual(result, { status: 'failure', code: 'INVALID_ROLL_FORMULA' });
  assert.equal(messages.length, 0);
});

test('player morale sends only the NPC UUID to authority', async () => {
  const requests = [];
  const { service } = dependencies({
    getCurrentUser: () => ({ id: 'player1', isGM: false }),
    authority: {
      async request(operation, payload) {
        requests.push([operation, payload]);
        return { status: 'success', code: null };
      }
    }
  });
  const result = await service.morale(actorFixture());
  assert.deepEqual(result, { status: 'success', code: null });
  assert.deepEqual(requests, [['morale.roll', { actorUuid: 'Actor.actor1' }]]);
});

test('active GM morale handler revalidates ownership and returns no hidden result', async () => {
  const actor = actorFixture();
  const { service, messages } = dependencies({
    resolveUuid: async () => actor,
    getUserById: (id) => ({ id, isGM: false })
  });
  const result = await service.handleMorale({
    senderUserId: 'player1',
    payload: { actorUuid: actor.uuid }
  });
  assert.deepEqual(result, { status: 'success', code: null });
  assert.equal('total' in result, false);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].rollMode, 'gmroll');
});

test('morale handler rejects unauthorized, malformed, and non-NPC requests', async () => {
  const actor = actorFixture({ testUserPermission: () => false });
  const { service, messages } = dependencies({ resolveUuid: async () => actor });
  assert.equal((await service.handleMorale({
    senderUserId: 'player1', payload: { actorUuid: actor.uuid }
  })).code, 'NOT_AUTHORIZED');
  assert.equal((await service.handleMorale({
    senderUserId: 'player1', payload: { actorUuid: actor.uuid, total: 2 }
  })).code, 'INVALID_REQUEST');
  assert.equal(messages.length, 0);
});
