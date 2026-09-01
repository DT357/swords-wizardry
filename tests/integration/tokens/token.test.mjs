import assert from 'node:assert/strict';
import test from 'node:test';

const calls = [];
globalThis.TokenDocument = class {
  async _preCreate(...args) { calls.push(['super', ...args]); return true; }
  updateSource(data) { calls.push(['source', structuredClone(data)]); this.source = data; }
};
globalThis.game = {
  user: { id: 'gm1', isGM: true, isActiveGM: true },
  i18n: { localize: (key) => key }
};
globalThis.ui = { notifications: { warn: (message) => calls.push(['warn', message]) } };
globalThis.Roll = class {
  static validate(formula) { return /^\d+d\d+(?: [+-] \d+)?$/.test(formula); }
  constructor(formula) { this.formula = formula; calls.push(['roll', formula]); }
  async evaluate() { this.total = 11; return this; }
};

const { SwordsWizardryTokenDocument } = await import('../../../module/tokens/token.mjs');

function tokenFixture(overrides = {}) {
  return Object.assign(new SwordsWizardryTokenDocument(), {
    actorLink: false,
    baseActor: {
      type: 'npc',
      system: { hd: '2d6+1', hp: { max: 0, value: 0 } }
    },
    ...overrides
  });
}

test('unlinked NPC HP is evaluated once and merged into creation source', async () => {
  calls.length = 0;
  const token = tokenFixture();
  await token._preCreate({}, {}, { id: 'gm1' });
  assert.equal(calls[0][0], 'super');
  assert.deepEqual(calls.filter(([kind]) => kind === 'roll'), [['roll', '2d6 + 1']]);
  assert.deepEqual(token.source, {
    delta: { system: { hp: { max: 11, value: 11 } } }
  });
});

test('linked, non-NPC, nonzero-HP, and inactive-GM creation skip generation', async () => {
  const variants = [
    tokenFixture({ actorLink: true }),
    tokenFixture({ baseActor: { type: 'character', system: { hd: '2', hp: { max: 0 } } } }),
    tokenFixture({ baseActor: { type: 'npc', system: { hd: '2', hp: { max: 4 } } } })
  ];
  game.user.isActiveGM = false;
  variants.push(tokenFixture());
  for (const token of variants) {
    calls.length = 0;
    await token._preCreate({}, {}, { id: 'gm1' });
    assert.equal(calls.some(([kind]) => kind === 'roll'), false);
    assert.equal(token.source, undefined);
  }
  game.user.isActiveGM = true;
});

test('invalid HD and nonpositive totals leave Token source unchanged and warn once', async () => {
  calls.length = 0;
  const invalid = tokenFixture({
    baseActor: { type: 'npc', system: { hd: '2d6 damage', hp: { max: 0 } } }
  });
  await invalid._preCreate({}, {}, { id: 'gm1' });
  assert.equal(calls.filter(([kind]) => kind === 'warn').length, 1);
  assert.equal(invalid.source, undefined);

  calls.length = 0;
  const originalEvaluate = Roll.prototype.evaluate;
  Roll.prototype.evaluate = async function() { this.total = 0; return this; };
  const nonpositive = tokenFixture();
  await nonpositive._preCreate({}, {}, { id: 'gm1' });
  assert.equal(calls.filter(([kind]) => kind === 'warn').length, 1);
  assert.equal(nonpositive.source, undefined);
  Roll.prototype.evaluate = originalEvaluate;
});
