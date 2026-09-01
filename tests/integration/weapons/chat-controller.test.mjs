import assert from 'node:assert/strict';
import test from 'node:test';

import { createApplicationId } from '../../../module/hit-points/domain.mjs';
import { WeaponChatController } from '../../../module/weapons/chat-controller.mjs';

function rootFixture() {
  const listeners = [];
  const appended = [];
  const root = {
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
  return root;
}

test('weapon controller registers one balanced render hook', () => {
  const calls = [];
  const controller = new WeaponChatController({
    hooks: {
      on(name, callback) { calls.push(['on', name, callback]); return 10; },
      off(name, id) { calls.push(['off', name, id]); }
    },
    weaponService: { damage: async () => ({ status: 'success' }) },
    authority: { request: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: (key) => key,
    notify() {}
  });
  controller.start();
  controller.start();
  controller.stop();
  controller.stop();
  assert.deepEqual(calls.map(([kind, name]) => [kind, name]), [
    ['on', 'renderChatMessageHTML'],
    ['off', 'renderChatMessageHTML']
  ]);
});

test('historical weapon controls are disabled with a localized reroll notice', () => {
  let render;
  const root = rootFixture();
  const control = { disabled: false, title: '' };
  root.querySelectorAll = (selector) => (
    selector === '.damage-roll-button, .apply-damage:not([data-action="spellApply"])'
      ? [control]
      : []
  );
  const controller = new WeaponChatController({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    weaponService: { damage: async () => ({ status: 'success' }) },
    authority: { request: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: () => 'Roll this weapon again.',
    notify() {}
  });
  controller.start();
  render({ uuid: 'ChatMessage.legacyWeapon', flags: {} }, root);

  assert.equal(control.disabled, true);
  assert.equal(control.title, 'Roll this weapon again.');
  assert.equal(root.appended[0].textContent, 'Roll this weapon again.');
});

test('spell damage controls are not mistaken for historical weapon controls', () => {
  let render;
  const root = rootFixture();
  const spellControl = {
    dataset: { action: 'spellApply' },
    disabled: false,
    title: ''
  };
  root.querySelectorAll = (selector) => (
    selector === '.damage-roll-button, .apply-damage' ? [spellControl] : []
  );
  const controller = new WeaponChatController({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    weaponService: { damage: async () => ({ status: 'success' }) },
    authority: { request: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: () => 'Roll this weapon again.',
    notify() {}
  });
  controller.start();
  render({ uuid: 'ChatMessage.spellDamage', flags: {} }, root);

  assert.equal(spellControl.disabled, false);
  assert.equal(spellControl.title, '');
  assert.equal(root.appended.length, 0);
});

test('attack and apply buttons delegate only trusted references', async () => {
  let render;
  const calls = [];
  const root = rootFixture();
  const message = {
    uuid: 'ChatMessage.weapon1',
    author: { id: 'gm1', isGM: true },
    flags: {
      'swords-wizardry': {
        weapon: { schemaVersion: 1, messageKind: 'weapon-attack' }
      }
    }
  };
  const controller = new WeaponChatController({
    hooks: {
      on(_name, callback) { render = callback; return 1; },
      off() {}
    },
    weaponService: {
      async damage(candidate) { calls.push(['damage', candidate.uuid]); return { status: 'success' }; }
    },
    authority: {
      async request(operation, payload) { calls.push([operation, payload]); return { status: 'success' }; }
    },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: (key) => key,
    notify() {}
  });
  controller.start();
  render(message, root);
  const listener = root.listeners[0][1];
  const attackButton = {
    dataset: { action: 'weaponDamage' }, disabled: false,
    closest: () => attackButton
  };
  await listener({ target: attackButton });

  message.flags['swords-wizardry'].weapon.messageKind = 'weapon-damage';
  const applyButton = {
    dataset: {
      action: 'weaponApply', mode: 'halfDamage', targetUuid: 'Actor.target1'
    },
    disabled: false,
    closest: () => applyButton
  };
  await listener({ target: applyButton });
  assert.deepEqual(calls, [
    ['damage', message.uuid],
    ['hitPoints.apply', {
      messageUuid: message.uuid,
      targetUuid: 'Actor.target1',
      mode: 'halfDamage'
    }]
  ]);
});

test('applied ledger entry removes controls after reload', () => {
  let render;
  let removed = false;
  const targetUuid = 'Actor.target1';
  const applicationId = createApplicationId({
    messageUuid: 'ChatMessage.damage1', targetUuid
  });
  const controls = { remove() { removed = true; } };
  const status = { textContent: '' };
  const target = {
    dataset: { weaponTargetUuid: targetUuid },
    querySelectorAll: () => [controls],
    querySelector: () => status
  };
  const root = rootFixture();
  root.querySelectorAll = (selector) => (
    selector === '[data-weapon-target-uuid]' ? [target] : []
  );
  const message = {
    uuid: 'ChatMessage.damage1',
    author: { id: 'gm1', isGM: true },
    flags: {
      'swords-wizardry': {
        weapon: { schemaVersion: 1, messageKind: 'weapon-damage' },
        hitPoints: {
          entries: {
            [applicationId]: {
              applicationId, status: 'applied', targetUuid,
              change: { appliedAmount: 3 }
            }
          }
        }
      }
    }
  };
  const controller = new WeaponChatController({
    hooks: { on(_name, callback) { render = callback; return 1; }, off() {} },
    weaponService: { damage: async () => ({ status: 'success' }) },
    authority: { request: async () => ({ status: 'success' }) },
    getCurrentUser: () => ({ id: 'gm1', isGM: true }),
    getUserById: () => ({ id: 'gm1', isGM: true }),
    dmAppliesDamage: () => true,
    localize: () => 'Applied',
    notify() {}
  });
  controller.start();
  render(message, root);
  assert.equal(removed, true);
  assert.equal(status.textContent, 'Applied');
});
