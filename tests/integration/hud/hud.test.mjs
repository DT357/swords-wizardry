import assert from 'node:assert/strict';
import test from 'node:test';

const hookCallbacks = new Map();
const hookCalls = [];
globalThis.Hooks = {
  on(name, callback) {
    hookCalls.push(['on', name]);
    hookCallbacks.set(name, callback);
    return `${name}-id`;
  },
  off(name, id) { hookCalls.push(['off', name, id]); hookCallbacks.delete(name); }
};
class FakeApplicationV2 {
  constructor(options = {}) { this.options = options; this.renderCount = 0; this.closed = false; }
  async render() { this.renderCount += 1; return this; }
  async close() {
    if (this.closeGate) await this.closeGate;
    this.closed = true;
    return this;
  }
  setPosition(position) { this.position = position; }
}
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: FakeApplicationV2,
      HandlebarsApplicationMixin: (Base) => Base
    }
  }
};
globalThis.game = {
  i18n: {
    format: (_key, data) => data.name,
    localize: (key) => key
  },
  settings: { get: () => true }
};
globalThis.document = {
  documentElement: { clientWidth: 800, clientHeight: 600 }
};
globalThis.canvas = {
  ready: true,
  tokens: { controlled: [] }
};

const { CombatHud } = await import('../../../module/hud/hud.mjs');

function token(id) {
  const actor = {
    uuid: `Actor.${id}`,
    name: `Actor ${id}`,
    items: new Map(),
    system: { hp: { value: 3, max: 5 }, spellSlots: {} },
    rollSaveCalls: 0,
    rollSave() { this.rollSaveCalls += 1; return { status: 'success' }; }
  };
  return {
    id,
    uuid: `Scene.scene1.Token.${id}`,
    actor,
    document: null
  };
}

test('HUD manager registers balanced hooks exactly once', async () => {
  hookCalls.length = 0;
  CombatHud.start();
  CombatHud.start();
  assert.deepEqual(hookCalls.filter(([kind]) => kind === 'on').map(([, name]) => name), [
    'controlToken', 'deleteToken', 'canvasTearDown', 'canvasReady',
    'updateActor', 'createItem', 'updateItem', 'deleteItem'
  ]);
  await CombatHud.stop();
  assert.equal(hookCalls.filter(([kind]) => kind === 'off').length, 8);
});

test('reconciliation preserves two controlled Tokens and closes only deselected HUD', async () => {
  CombatHud.start();
  const first = token('one');
  const second = token('two');
  canvas.tokens.controlled = [first, second];
  await CombatHud.reconcile();
  assert.deepEqual([...CombatHud.instances.keys()], [first.uuid, second.uuid]);

  canvas.tokens.controlled = [second];
  await CombatHud.reconcile();
  assert.deepEqual([...CombatHud.instances.keys()], [second.uuid]);
  assert.equal(CombatHud.instances.get(second.uuid).closed, false);
  await CombatHud.closeAll();
});

test('overlapping control changes cannot recreate a stale HUD', async () => {
  const first = token('race-one');
  const second = token('race-two');
  canvas.tokens.controlled = [first, second];
  await CombatHud.reconcile();

  let releaseClose;
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });
  CombatHud.instances.get(first.uuid).closeGate = closeGate;
  canvas.tokens.controlled = [second];
  const firstReconcile = CombatHud.reconcile();
  await Promise.resolve();

  canvas.tokens.controlled = [];
  const secondReconcile = CombatHud.reconcile();
  releaseClose();
  await Promise.all([firstReconcile, secondReconcile]);

  assert.equal(CombatHud.instances.size, 0);
});

test('declared actions call Actor and Item services without mutating spell slots', async () => {
  const controlled = token('actions');
  const calls = [];
  const weapon = { id: 'weapon', roll: async () => { calls.push('weapon'); } };
  const spell = { id: 'spell', cast: async () => { calls.push('spell'); } };
  controlled.actor.items.set('weapon', weapon);
  controlled.actor.items.set('spell', spell);
  const hud = new CombatHud(controlled);
  const before = structuredClone(controlled.actor.system.spellSlots);
  await CombatHud.DEFAULT_OPTIONS.actions.save.call(hud, {}, {});
  await CombatHud.DEFAULT_OPTIONS.actions.item.call(hud, {}, { dataset: { itemId: 'weapon' } });
  await CombatHud.DEFAULT_OPTIONS.actions.cast.call(hud, {}, { dataset: { itemId: 'spell' } });
  assert.equal(controlled.actor.rollSaveCalls, 1);
  assert.deepEqual(calls, ['weapon', 'spell']);
  assert.deepEqual(controlled.actor.system.spellSlots, before);
  await hud.close();
});

test('related update bursts coalesce and a close invalidates scheduled render', async () => {
  const controlled = token('burst');
  const hud = new CombatHud(controlled);
  hud.scheduleRender();
  hud.scheduleRender();
  hud.scheduleRender();
  await Promise.resolve();
  assert.equal(hud.renderCount, 1);

  hud.scheduleRender();
  await hud.close();
  await Promise.resolve();
  assert.equal(hud.renderCount, 1);
});

test('HUD title is the Actor name and first render centers it on the left', () => {
  const controlled = token('position');
  const hud = new CombatHud(controlled);
  hud.element = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 240 })
  };
  assert.equal(hud.title, controlled.actor.name);

  hud._onRender({}, { isFirstRender: true });
  assert.deepEqual(hud.position, { left: 15, top: 180, width: 200 });

  hud.element.getBoundingClientRect = () => ({
    left: 125, top: 90, width: 200, height: 240
  });
  hud._onRender({}, { isFirstRender: false });
  assert.deepEqual(hud.position, { left: 125, top: 90, width: 200 });
});

test('HUD grows to fit its longest action label and remains inside the viewport', () => {
  const controlled = token('intrinsic-width');
  const hud = new CombatHud(controlled);
  const status = { scrollWidth: 110 };
  const image = { getBoundingClientRect: () => ({ width: 24 }) };
  const label = { scrollWidth: 210 };
  const button = {
    querySelector: (selector) => selector === 'img' ? image : label
  };
  const content = {
    getBoundingClientRect: () => ({ width: 168 }),
    querySelector: () => status,
    querySelectorAll: () => [button]
  };
  hud.element = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 240 }),
    querySelector: () => content
  };
  globalThis.getComputedStyle = () => ({
    columnGap: '6px',
    gap: '6px',
    paddingLeft: '0px',
    paddingRight: '0px'
  });

  hud._onRender({}, { isFirstRender: true });
  assert.deepEqual(hud.position, { left: 15, top: 180, width: 272 });

  label.scrollWidth = 1_000;
  hud._onRender({}, { isFirstRender: false });
  assert.deepEqual(hud.position, { left: 0, top: 0, width: 350 });
});
