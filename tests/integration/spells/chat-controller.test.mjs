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

  assert.equal(calls.filter(([type]) => type === 'on').length, 1);
  assert.deepEqual(calls.at(-1).slice(0, 2), ['off', 'renderChatMessageHTML']);
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
    on(_name, callback) { renderCallback = callback; return 1; },
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
      on(_name, callback) { renderCallback = callback; return 1; },
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
