import assert from 'node:assert/strict';
import test from 'node:test';

const events = [];
globalThis.foundry = {
  applications: { sidebar: { tabs: { CombatTracker: class {
    async _onRender(context, options) {
      events.push(['tracker-render', context, options]);
      return options;
    }
  } } } },
  utils: { hasProperty: (object, key) => Object.hasOwn(object, key) }
};
globalThis.game = {
  user: { id: 'gm1', isGM: true, isActiveGM: true },
  i18n: { localize: (key) => key },
  scenes: { current: null }
};
globalThis.canvas = { ready: false };
globalThis.ui = { notifications: { error() {} } };
globalThis.Combat = class {
  _onUpdate(...args) { events.push(['super', ...args]); }
  _onCreate(...args) { events.push(['create', ...args]); }
  _onDelete(...args) { events.push(['delete', ...args]); }
};
globalThis.Roll = class {
  constructor(formula) { this.formula = formula; this.total = 0; }
  async evaluate() { this.total = 3; return this; }
  async render() { return '<span>3</span>'; }
};
globalThis.ChatMessage = {
  getSpeaker: () => ({ alias: 'Initiative' }),
  applyMode: (data) => data,
  create: async () => ({ uuid: 'ChatMessage.initiative' })
};
globalThis.renderTemplate = async () => '<p>initiative</p>';

const {
  SIDE_INITIATIVE_OPTION,
  SwordsWizardryCombat,
  SwordsWizardryCombatTracker
} = await import('../../../module/combat/combat.mjs');

test('combat tracker guards a missing v14 render-data entry', async () => {
  events.length = 0;
  const tracker = Object.assign(new SwordsWizardryCombatTracker(), {
    viewed: { id: 'active-combat' }
  });
  const options = {
    parts: ['tracker'],
    renderContext: 'updateCombat',
    renderData: [{ _id: 'different-combat', turn: 1 }]
  };

  await tracker._onRender({}, options);

  assert.equal(events[0][0], 'tracker-render');
  assert.equal(events[0][2].renderData, null);
  assert.deepEqual(options.renderData, [{ _id: 'different-combat', turn: 1 }]);
});

test('_onUpdate calls its parent first and remains synchronous', () => {
  events.length = 0;
  const actor = { isOwner: true, sheet: { rendered: true, render: () => events.push(['sheet']) } };
  const combat = Object.assign(new SwordsWizardryCombat(), {
    combatants: [{ actor }],
    combatant: null
  });
  const changed = { round: 2 };
  const options = { [SIDE_INITIATIVE_OPTION]: true };
  const returned = combat._onUpdate(changed, options, 'gm1');

  assert.equal(returned instanceof Promise, false);
  assert.deepEqual(events[0], ['super', changed, options, 'gm1']);
  assert.deepEqual(events[1], ['sheet']);
});

test('rollSideInitiative performs one batch, one turn update, and one message', async () => {
  const writes = [];
  const messages = [];
  let rollTotal = 4;
  globalThis.Roll = class {
    constructor() { this.total = rollTotal; rollTotal -= 1; }
    async evaluate() { return this; }
    async render() { return `<span>${this.total}</span>`; }
  };
  globalThis.ChatMessage.create = async (data) => { messages.push(data); return data; };
  const combat = Object.assign(new SwordsWizardryCombat(), {
    combatants: [
      { id: 'party', token: { disposition: 1 }, actor: null },
      { id: 'enemy', token: { disposition: -1 }, actor: null }
    ],
    async updateEmbeddedDocuments(type, updates) { writes.push([type, updates]); },
    async update(changes, options) { writes.push(['Combat', changes, options]); }
  });

  const result = await combat.rollSideInitiative();

  assert.equal(result.status, 'success');
  assert.deepEqual(writes[0], ['Combatant', [
    { _id: 'party', initiative: 4 },
    { _id: 'enemy', initiative: 3 }
  ]]);
  assert.equal(writes[1][1].turn, 0);
  assert.equal(writes[1][2][SIDE_INITIATIVE_OPTION], true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].rolls.length, 2);
});

test('inactive GM and empty combat fail safely without mutations', async () => {
  game.user.isActiveGM = false;
  const combat = Object.assign(new SwordsWizardryCombat(), {
    combatants: [],
    updateEmbeddedDocuments: async () => assert.fail('should not update'),
    update: async () => assert.fail('should not update')
  });
  assert.deepEqual(await combat.rollSideInitiative(), {
    status: 'failure', code: 'NO_ACTIVE_GM'
  });
  game.user.isActiveGM = true;
});
