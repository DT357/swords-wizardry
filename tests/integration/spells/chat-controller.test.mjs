import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationId } from '../../../module/hit-points/domain.mjs';
import { SpellChatController } from '../../../module/spells/chat-controller.mjs';
import { SPELL_MESSAGE_SCHEMA_VERSION } from '../../../module/spells/constants.mjs';

const SYSTEM_ID = 'swords-wizardry';

function rootFixture() {
  const listeners = [];
  const appended = [];
  return {
    dataset: {},
    listeners,
    appended,
    ownerDocument: {
      createElement: () => ({ className: '', textContent: '', setAttribute() {} })
    },
    append(element) { appended.push(element); },
    addEventListener(type, callback) { listeners.push([type, callback]); },
    matches: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => true
  };
}

function dependencies(overrides = {}) {
  return {
    hooks: { on: () => 1, off() {} },
    spellService: { invoke: async () => ({ status: 'success' }) },
    authority: { request: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: (key) => key,
    notify() {},
    ...overrides
  };
}

test('chat controller registers one balanced render hook', () => {
  const calls = [];
  const controller = new SpellChatController(dependencies({
    hooks: {
      on(name, callback) { calls.push(['on', name, callback]); return 42; },
      off(name, id) { calls.push(['off', name, id]); }
    }
  }));

  controller.start();
  controller.start();
  controller.stop();
  controller.stop();

  assert.deepEqual(calls.map(([kind, name]) => [kind, name]), [
    ['on', 'renderChatMessageHTML'],
    ['off', 'renderChatMessageHTML']
  ]);
});

test('player spell-card action delegates to the revalidating authority workflow', async () => {
  let render;
  const calls = [];
  const root = rootFixture();
  const message = {
    uuid: 'ChatMessage.spell1',
    author: { id: 'player1' },
    flags: {
      [SYSTEM_ID]: {
        spell: { schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION, messageKind: 'spell-card' }
      }
    }
  };
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    spellService: {
      async invoke(candidate, actionId) {
        calls.push([candidate.uuid, actionId]);
        return { status: 'success' };
      }
    },
    getUserById: () => ({ id: 'player1', isGM: false })
  }));
  controller.start();
  render(message, root);

  const listener = root.listeners[0][1];
  const button = {
    dataset: { action: 'spellAction', spellActionId: 'effect1' },
    disabled: false,
    closest: () => button
  };
  await listener({ target: button });

  assert.deepEqual(calls, [['ChatMessage.spell1', 'effect1']]);
});

test('apply button sends only the trusted result and target references', async () => {
  let render;
  const calls = [];
  const root = rootFixture();
  const message = {
    uuid: 'ChatMessage.result1',
    author: { id: 'gm1' },
    flags: {
      [SYSTEM_ID]: {
        spell: { schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION, messageKind: 'spell-result' }
      }
    }
  };
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    authority: {
      async request(operation, payload) {
        calls.push([operation, payload]);
        return { status: 'success' };
      }
    }
  }));
  controller.start();
  render(message, root);

  const listener = root.listeners[0][1];
  const button = {
    dataset: {
      action: 'spellApply', mode: 'halfDamage', targetUuid: 'Actor.target1'
    },
    disabled: false,
    closest: () => button
  };
  await listener({ target: button });

  assert.deepEqual(calls, [[
    'hitPoints.apply',
    {
      messageUuid: 'ChatMessage.result1',
      targetUuid: 'Actor.target1',
      mode: 'halfDamage'
    }
  ]]);
});

test('non-GM-authored result cards are display-only', () => {
  let render;
  let removed = false;
  const root = rootFixture();
  root.querySelectorAll = (selector) => (
    selector === '.spell-result__application-controls'
      ? [{ remove() { removed = true; } }]
      : []
  );
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    getUserById: () => ({ id: 'player1', isGM: false })
  }));
  controller.start();
  render({
    uuid: 'ChatMessage.forged',
    author: { id: 'player1' },
    flags: {
      [SYSTEM_ID]: {
        spell: { schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION, messageKind: 'spell-result' }
      }
    }
  }, root);

  assert.equal(removed, true);
  assert.equal(root.listeners.length, 0);
  assert.equal(root.appended.length, 1);
  assert.equal(root.appended[0].className, 'spell-card__legacy-warning');
});

test('historical spell cards show a localized repost notice', () => {
  let render;
  const root = rootFixture();
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    localize: () => 'Post this spell again.'
  }));
  controller.start();
  render({
    uuid: 'ChatMessage.legacySpell',
    author: { id: 'player1' },
    flags: {
      [SYSTEM_ID]: {
        spell: { schemaVersion: 1, messageKind: 'spell-card' }
      }
    }
  }, root);

  assert.equal(root.listeners.length, 0);
  assert.equal(root.appended[0].textContent, 'Post this spell again.');
});

test('applied ledger entry removes controls after reload', () => {
  let render;
  let removed = false;
  const targetUuid = 'Actor.target1';
  const messageUuid = 'ChatMessage.result1';
  const applicationId = createApplicationId({ messageUuid, targetUuid });
  const controls = { remove() { removed = true; } };
  const status = { textContent: '' };
  const target = {
    dataset: { spellTargetUuid: targetUuid },
    querySelectorAll: () => [controls],
    querySelector: () => status
  };
  const root = rootFixture();
  root.querySelectorAll = (selector) => (
    selector === '[data-spell-target-uuid]' ? [target] : []
  );
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    localize: () => 'Applied'
  }));
  controller.start();
  render({
    uuid: messageUuid,
    author: { id: 'gm1' },
    flags: {
      [SYSTEM_ID]: {
        spell: { schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION, messageKind: 'spell-result' },
        hitPoints: {
          entries: {
            [applicationId]: {
              applicationId,
              status: 'applied',
              targetUuid,
              change: { appliedAmount: 3 }
            }
          }
        }
      }
    }
  }, root);

  assert.equal(removed, true);
  assert.equal(status.textContent, 'Applied');
});

test('automatic result cards and non-GM viewers do not expose manual controls', () => {
  let render;
  let manual = false;
  let currentUser = { id: 'gm1', isGM: true };
  const controller = new SpellChatController(dependencies({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    getCurrentUser: () => currentUser,
    dmAppliesDamage: () => manual
  }));
  controller.start();

  const renderControls = () => {
    let removed = false;
    const root = rootFixture();
    root.querySelectorAll = (selector) => (
      selector === '.spell-result__application-controls'
        ? [{ remove() { removed = true; } }]
        : []
    );
    render({
      uuid: 'ChatMessage.result2',
      author: { id: 'gm1' },
      flags: {
        [SYSTEM_ID]: {
          spell: {
            schemaVersion: SPELL_MESSAGE_SCHEMA_VERSION,
            messageKind: 'spell-result',
            action: { kind: 'damage' }
          }
        }
      }
    }, root);
    return removed;
  };

  assert.equal(renderControls(), true);
  manual = true;
  assert.equal(renderControls(), false);
  currentUser = { id: 'player1', isGM: false };
  assert.equal(renderControls(), true);
});
