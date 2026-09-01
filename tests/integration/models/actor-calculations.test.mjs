import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Actor = class {
  getRollData() { return {}; }
  _preUpdate() {}
};
globalThis.game = { settings: { get: () => true } };
globalThis.foundry = {
  utils: {
    deepClone: structuredClone,
    mergeObject: Object.assign
  }
};

const { SwordsWizardryActor } = await import('../../../module/actor/actor.mjs?actor-calculations');

test('zero item quantity contributes zero encumbrance', () => {
  const actor = new SwordsWizardryActor();
  const actorData = {
    items: [
      { type: 'item', system: { weight: 10, quantity: 0 } },
      { type: 'weapon', system: { weight: 3, quantity: 2 } }
    ],
    system: {
      treasure: { gp: 0, pp: 0, sp: 0, cp: 0 },
      modifiers: { carry: { value: 0 } },
      carryWeight: { value: 0 },
      moveRate: { value: 0 }
    }
  };
  actor._calculateEncumbrance(actorData);
  assert.equal(actorData.system.carryWeight.value, 6);
  assert.equal(actorData.system.moveRate.value, 12);
});
