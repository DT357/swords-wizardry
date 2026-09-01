import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpellMessageSnapshot } from '../../../module/spells/domain.mjs';
import { SpellService } from '../../../module/spells/service.mjs';
import { applyFoundryChatVisibility } from '../../../module/rolls/chat-visibility.mjs';

function createFixture(overrides = {}) {
  const actor = {
    id: 'actor-1',
    uuid: 'Actor.actor-1',
    name: 'Merlin',
    type: 'character',
    isOwner: true,
    system: {
      level: { value: '5' },
      spellSlots: {
        3: { max: 2, memorized: ['spell-1', 'spell-1'] }
      },
      aac: { value: 10 },
      ac: { value: 9 },
      tHAC0: 19
    },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      const prepared = changes['system.spellSlots.3.memorized'];
      if (prepared) this.system.spellSlots[3].memorized = [...prepared];
      return this;
    }
  };
  const item = {
    id: 'spell-1',
    _id: 'spell-1',
    uuid: 'Actor.actor-1.Item.spell-1',
    name: 'Fireball',
    img: 'fireball.svg',
    type: 'spell',
    isOwner: true,
    actor,
    parent: actor,
    system: {
      description: '<p>A bright explosion.</p>',
      spellLevel: 3,
      range: '240 feet',
      duration: 'Instantaneous',
      casting: { levelSource: 'fixed', fixedLevel: 5 },
      actions: [{
        id: 'fire-damage',
        kind: 'damage',
        label: 'Fire damage',
        formula: '(@spell.casterLevel)d6',
        target: { mode: 'selected' },
        save: { outcome: 'half', notes: 'Save for half.' },
        attack: { mode: 'none', notes: '' },
        effect: { reference: '' },
        notes: ''
      }]
    }
  };
  const documents = new Map([[actor.uuid, actor], [item.uuid, item]]);
  const createdMessages = [];
  let messageCounter = 0;
  const deps = {
    async resolveUuid(uuid) {
      return documents.get(uuid) ?? null;
    },
    async enrichHTML(html) {
      return html;
    },
    async renderTemplate(path, context) {
      return JSON.stringify({ path, context });
    },
    async createChatMessage(data) {
      messageCounter += 1;
      const message = {
        id: `message-${messageCounter}`,
        uuid: `ChatMessage.message-${messageCounter}`,
        author: { id: 'user-1' },
        ...data,
        updates: [],
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async update(changes) {
          this.updates.push(changes);
          if (changes.flags) this.flags = changes.flags;
          const spellFlags = changes['flags.swords-wizardry.spell'];
          if (spellFlags) this.flags['swords-wizardry'].spell = spellFlags;
          return this;
        }
      };
      documents.set(message.uuid, message);
      createdMessages.push(message);
      return message;
    },
    async evaluateRoll(formula, data) {
      return {
        formula,
        data,
        total: 18,
        roll: { formula, total: 18 },
        html: '<div class="dice-roll">18</div>'
      };
    },
    async promptCasterLevel() {
      return 5;
    },
    getSelectedTargetUuids() {
      return ['Scene.scene-1.Token.live-target'];
    },
    getRollMode() {
      return 'publicroll';
    },
    getSpeaker() {
      return { actor: actor.id };
    },
    getCurrentUser() {
      return { id: 'user-1', isGM: false };
    },
    localize(key) {
      return key;
    },
    notify() {}
  };
  Object.assign(deps, overrides.deps ?? {});
  return { actor, item, documents, createdMessages, deps };
}

test('post creates a versioned card and does not consume preparation', async () => {
  const fixture = createFixture();
  const service = new SpellService(fixture.deps);
  const result = await service.post(fixture.item);

  assert.equal(result.status, 'success');
  assert.equal(fixture.createdMessages.length, 1);
  assert.equal(fixture.actor.updates.length, 0);
  const flags = fixture.createdMessages[0].flags['swords-wizardry'].spell;
  assert.equal(flags.messageKind, 'spell-card');
  assert.equal(flags.sourceItemUuid, fixture.item.uuid);
  assert.equal(flags.casting.casterLevel, 5);
});

test('cast persists removal of exactly one prepared occurrence after card creation', async () => {
  const fixture = createFixture();
  const service = new SpellService(fixture.deps);
  const result = await service.cast(fixture.item);

  assert.equal(result.status, 'success');
  assert.equal(fixture.createdMessages.length, 1);
  assert.deepEqual(fixture.actor.system.spellSlots[3].memorized, ['spell-1']);
  assert.deepEqual(fixture.actor.updates, [{
    'system.spellSlots.3.memorized': ['spell-1']
  }]);
});

test('concurrent cast attempts consume and post at most one occurrence', async () => {
  const fixture = createFixture();
  fixture.actor.system.spellSlots[3].memorized = ['spell-1'];
  const service = new SpellService(fixture.deps);
  const [first, second] = await Promise.all([
    service.cast(fixture.item),
    service.cast(fixture.item)
  ]);

  assert.deepEqual([first.status, second.status].sort(), ['failure', 'success']);
  assert.equal(fixture.createdMessages.length, 1);
  assert.deepEqual(fixture.actor.system.spellSlots[3].memorized, []);
});

test('message creation failure and prompt cancellation consume nothing', async () => {
  const failedFixture = createFixture({
    deps: {
      async createChatMessage() {
        throw new Error('chat unavailable');
      }
    }
  });
  const failedService = new SpellService(failedFixture.deps);
  const failed = await failedService.cast(failedFixture.item);
  assert.equal(failed.status, 'failure');
  assert.equal(failed.code, 'MESSAGE_CREATE_FAILED');
  assert.equal(failedFixture.actor.updates.length, 0);

  const cancelledFixture = createFixture({
    deps: {
      async promptCasterLevel() {
        return null;
      }
    }
  });
  cancelledFixture.item.system.casting = { levelSource: 'prompt', fixedLevel: null };
  const cancelledService = new SpellService(cancelledFixture.deps);
  const cancelled = await cancelledService.cast(cancelledFixture.item);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelledFixture.createdMessages.length, 0);
  assert.equal(cancelledFixture.actor.updates.length, 0);
});

test('failed prepared-state persistence marks the created card for audit', async () => {
  const fixture = createFixture();
  fixture.actor.update = async () => {
    throw new Error('world write failed');
  };
  const service = new SpellService(fixture.deps);
  const result = await service.cast(fixture.item);

  assert.equal(result.status, 'failure');
  assert.equal(result.code, 'CONSUMPTION_FAILED');
  const spellFlags = fixture.createdMessages[0].flags['swords-wizardry'].spell;
  assert.equal(spellFlags.consumption.status, 'failed');
});

test('invoke uses the selected UUID snapshot and creates a roll result message', async () => {
  const fixture = createFixture();
  const service = new SpellService(fixture.deps);
  const posted = await service.post(fixture.item);
  const result = await service.invoke(posted.message.uuid, 'fire-damage', {
    targetUuids: ['Scene.scene-1.Token.explicit-target']
  });

  assert.equal(result.status, 'success');
  assert.equal(fixture.createdMessages.length, 2);
  const resultFlags = fixture.createdMessages[1].flags['swords-wizardry'].spell;
  assert.equal(resultFlags.messageKind, 'spell-result');
  assert.deepEqual(resultFlags.targetUuids, ['Scene.scene-1.Token.explicit-target']);
  assert.equal(resultFlags.result.total, 18);
  assert.equal(resultFlags.action.id, 'fire-damage');
});

test('invoke rejects an unauthorized user before resolving the action', async () => {
  const fixture = createFixture();
  const snapshot = JSON.parse(JSON.stringify(buildSpellMessageSnapshot({
    item: fixture.item,
    caster: fixture.actor,
    casting: { casterLevel: 5, source: 'fixed' },
    targetUuids: []
  })));
  snapshot.actions[0].fingerprint = 'stale';
  const message = {
    uuid: 'ChatMessage.stale-message',
    author: { id: 'other-user' },
    flags: { 'swords-wizardry': { spell: snapshot } },
    getFlag(scope, key) { return this.flags[scope][key]; }
  };
  fixture.documents.set(message.uuid, message);
  fixture.actor.isOwner = false;
  fixture.item.isOwner = false;
  const service = new SpellService(fixture.deps);
  const result = await service.invoke(message.uuid, 'fire-damage', {
    targetUuids: ['Scene.scene-1.Token.explicit-target']
  });

  assert.equal(result.status, 'failure');
  assert.equal(result.code, 'NOT_AUTHORIZED');
  assert.equal(fixture.createdMessages.length, 0);
});

test('invoke rejects a stale action fingerprint without evaluating a roll', async () => {
  let evaluated = false;
  const fixture = createFixture({
    deps: {
      async evaluateRoll() {
        evaluated = true;
        return { total: 1, formula: '1d6', html: '', roll: null };
      }
    }
  });
  const posted = await new SpellService(fixture.deps).post(fixture.item);
  posted.message.flags['swords-wizardry'].spell.actions[0].fingerprint = 'deadbeef';
  const result = await new SpellService(fixture.deps).invoke(
    posted.message,
    'fire-damage',
    { targetUuids: ['Scene.scene-1.Token.explicit-target'] }
  );
  assert.equal(result.code, 'STALE_ACTION');
  assert.equal(evaluated, false);
});

test('post and invoke forward every supported core roll mode', async () => {
  for (const rollMode of ['publicroll', 'gmroll', 'blindroll', 'selfroll']) {
    const evaluatedModes = [];
    const fixture = createFixture({
      deps: {
        async evaluateRoll(formula, data, options) {
          evaluatedModes.push(options.rollMode);
          return {
            formula,
            data,
            total: 18,
            roll: { formula, total: 18 },
            html: '<div class="dice-roll">18</div>'
          };
        }
      }
    });
    const service = new SpellService(fixture.deps);
    const posted = await service.post(fixture.item, { rollMode });
    const invoked = await service.invoke(posted.message, 'fire-damage', {
      rollMode,
      targetUuids: ['Scene.scene-1.Token.explicit-target']
    });

    assert.equal(posted.status, 'success');
    assert.equal(invoked.status, 'success');
    assert.deepEqual(evaluatedModes, [rollMode]);
    assert.deepEqual(
      fixture.createdMessages.map((message) => message.rollMode),
      [rollMode, rollMode]
    );
  }
});

test('Foundry chat compatibility adapter applies v13 roll modes and v14 visibility modes', () => {
  const calls = [];
  const v13ChatMessage = {
    applyRollMode(data, mode) {
      calls.push({ generation: 13, mode });
      data.whisper = mode === 'publicroll' ? [] : ['gm'];
      data.blind = mode === 'blindroll';
      return data;
    }
  };
  const v14ChatMessage = {
    applyMode(data, mode) {
      calls.push({ generation: 14, mode });
      data.whisper = mode === 'public' ? [] : ['gm'];
      data.blind = mode === 'blind';
      return data;
    }
  };

  const v13Data = applyFoundryChatVisibility(v13ChatMessage, {
    content: 'legacy',
    rollMode: 'blindroll'
  });
  const v14Data = applyFoundryChatVisibility(v14ChatMessage, {
    content: 'current',
    rollMode: 'selfroll'
  });

  assert.deepEqual(calls, [
    { generation: 13, mode: 'blindroll' },
    { generation: 14, mode: 'self' }
  ]);
  assert.equal('rollMode' in v13Data, false);
  assert.equal(v13Data.blind, true);
  assert.equal('rollMode' in v14Data, false);
  assert.deepEqual(v14Data.whisper, ['gm']);
});
