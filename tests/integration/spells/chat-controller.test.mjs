import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationId } from '../../../module/spells/application.mjs';
import { SpellChatController } from '../../../module/spells/chat-controller.mjs';

test('chat controller registers once and balances its hook on stop', () => {
  const calls = [];
  const hooks = {
    on(name, callback) {
      calls.push(['on', name, callback]);
      return 42;
    },
    off(name, id) {
      calls.push(['off', name, id]);
    }
  };
  const controller = new SpellChatController({
    hooks,
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: { apply: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    localize: (key) => key,
    notify() {}
  });

  controller.start();
  controller.start();
  controller.stop();
  controller.stop();

  assert.deepEqual(
    calls.filter(([type]) => type === 'on').map(([, name]) => name),
    ['renderChatMessageHTML', 'createChatMessage']
  );
  assert.deepEqual(
    calls.filter(([type]) => type === 'off').map(([, name]) => name),
    ['renderChatMessageHTML', 'createChatMessage']
  );
});

test('unchecked DM damage setting auto-applies full spell damage on the active GM', async () => {
  const callbacks = {};
  const applications = [];
  const controller = new SpellChatController({
    hooks: {
      on(name, callback) { callbacks[name] = callback; return name; },
      off() {}
    },
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: {
      async applyAutomatically(message, options) {
        applications.push({ message, options });
        return { status: 'success' };
      }
    },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    getActiveGM: () => ({ id: 'gm' }),
    dmAppliesDamage: () => false,
    localize: (key) => key,
    notify() {}
  });
  controller.start();
  const message = {
    uuid: 'ChatMessage.damage-result',
    getFlag: () => ({
      messageKind: 'spell-result',
      action: { kind: 'damage' },
      targetUuids: ['Scene.scene.Token.one', 'Scene.scene.Token.two']
    })
  };

  await callbacks.createChatMessage(message, {}, 'player');

  assert.deepEqual(applications, [
    {
      message,
      options: {
        requestingUserId: 'player',
        targetUuid: 'Scene.scene.Token.one'
      }
    },
    {
      message,
      options: {
        requestingUserId: 'player',
        targetUuid: 'Scene.scene.Token.two'
      }
    }
  ]);
});

test('automatic spell damage does not run when manual application is required', async () => {
  const callbacks = {};
  let applications = 0;
  const controller = new SpellChatController({
    hooks: {
      on(name, callback) { callbacks[name] = callback; return name; },
      off() {}
    },
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: {
      async applyAutomatically() { applications += 1; return { status: 'success' }; }
    },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    getActiveGM: () => ({ id: 'gm' }),
    dmAppliesDamage: () => true,
    localize: (key) => key,
    notify() {}
  });
  controller.start();

  await callbacks.createChatMessage({
    getFlag: () => ({
      messageKind: 'spell-result',
      action: { kind: 'damage' },
      targetUuids: ['Scene.scene.Token.one']
    })
  }, {}, 'player');

  assert.equal(applications, 0);
});

test('automatic spell damage and healing run only on the designated active GM', async () => {
  const callbacks = {};
  const applications = [];
  let activeGmId = 'other-gm';
  const controller = new SpellChatController({
    hooks: {
      on(name, callback) { callbacks[name] = callback; return name; },
      off() {}
    },
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: {
      async applyAutomatically(message) {
        applications.push(message.getFlag().action.kind);
        return { status: 'success' };
      }
    },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    getActiveGM: () => ({ id: activeGmId }),
    dmAppliesDamage: () => false,
    localize: (key) => key,
    notify() {}
  });
  controller.start();
  const result = (kind) => ({
    getFlag: () => ({
      messageKind: 'spell-result',
      action: { kind },
      targetUuids: ['Scene.scene.Token.one']
    })
  });

  await callbacks.createChatMessage(result('damage'), {}, 'player');
  activeGmId = 'gm';
  await callbacks.createChatMessage(result('healing'), {}, 'player');

  assert.deepEqual(applications, ['healing']);
});

test('render binding attaches one delegated listener to a spell card root', () => {
  let renderCallback;
  const listeners = [];
  const root = {
    dataset: {},
    addEventListener(type, callback) {
      listeners.push([type, callback]);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const hooks = {
    on(name, callback) {
      if (name === 'renderChatMessageHTML') renderCallback = callback;
      return name;
    },
    off() {}
  };
  const controller = new SpellChatController({
    hooks,
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: { apply: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    localize: (key) => key,
    notify() {}
  });
  controller.start();
  const message = { getFlag: () => ({ messageKind: 'spell-card' }) };

  renderCallback(message, root);
  renderCallback(message, root);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0][0], 'click');
});

test('a new result card ignores application entries belonging to an older message', () => {
  let renderCallback;
  let controlsRemoved = false;
  const targetUuid = 'Scene.scene-1.Token.token-1';
  const status = { textContent: '' };
  const controls = { remove() { controlsRemoved = true; } };
  const target = {
    dataset: { spellTargetUuid: targetUuid },
    querySelectorAll: () => [controls],
    querySelector: () => status
  };
  const root = {
    dataset: {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === '[data-spell-target-uuid]' ? [target] : [];
    }
  };
  const actionId = 'damage-action';
  const priorApplicationId = createApplicationId({
    messageUuid: 'ChatMessage.result-1',
    actionId,
    targetUuid
  });
  const spell = {
    messageKind: 'spell-result',
    application: {
      entries: {
        [priorApplicationId]: {
          applicationId: priorApplicationId,
          actionId,
          targetUuid,
          appliedAmount: 2
        }
      }
    }
  };
  const controller = new SpellChatController({
    hooks: {
      on(name, callback) {
        if (name === 'renderChatMessageHTML') renderCallback = callback;
        return name;
      },
      off() {}
    },
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: { apply: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    localize: () => 'Applied: 2',
    notify() {}
  });
  controller.start();

  renderCallback({
    uuid: 'ChatMessage.result-2',
    getFlag: () => spell
  }, root);

  assert.equal(controlsRemoved, false);
  assert.equal(status.textContent, '');
});

test('automatic damage and healing cards hide manual controls', () => {
  let renderCallback;
  let requiresManualApplication = false;
  const render = (kind) => {
    let controlsRemoved = false;
    const controls = { remove() { controlsRemoved = true; } };
    const root = {
      dataset: {},
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll(selector) {
        return selector === '.spell-result__application-controls' ? [controls] : [];
      }
    };
    renderCallback({
      uuid: `ChatMessage.${kind}`,
      getFlag: () => ({
        messageKind: 'spell-result',
        action: { kind },
        application: { entries: {} }
      })
    }, root);
    return controlsRemoved;
  };
  const controller = new SpellChatController({
    hooks: {
      on(name, callback) {
        if (name === 'renderChatMessageHTML') renderCallback = callback;
        return name;
      },
      off() {}
    },
    spellService: { invoke: async () => ({ status: 'success' }) },
    applicationService: { apply: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm', isGM: true }),
    dmAppliesDamage: () => requiresManualApplication,
    localize: (key) => key,
    notify() {}
  });
  controller.start();

  assert.equal(render('damage'), true);
  assert.equal(render('healing'), true);
  requiresManualApplication = true;
  assert.equal(render('damage'), false);
  assert.equal(render('healing'), false);
});
