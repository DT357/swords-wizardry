import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintAction, normalizeSpellAction } from '../../../module/spells/domain.mjs';
import { SpellApplicationService } from '../../../module/spells/application.mjs';

function fixture({ isGM = true, failMessageUpdate = false, failRollback = false } = {}) {
  const action = normalizeSpellAction({
    id: 'damage-action',
    kind: 'damage',
    label: 'Damage',
    formula: '1d6',
    target: { mode: 'single' }
  });
  const actor = {
    uuid: 'Actor.base-actor',
    system: { hp: { value: 10, max: 12 } },
    updates: [],
    async update(changes) {
      this.updates.push(changes);
      const value = changes['system.hp.value'];
      if (failRollback && value === 10) throw new Error('rollback failed');
      this.system.hp.value = value;
      return this;
    }
  };
  const token = {
    uuid: 'Scene.scene-1.Token.token-1',
    name: 'Target',
    actor
  };
  const flags = {
    schemaVersion: 1,
    messageKind: 'spell-result',
    sourceMessageUuid: 'ChatMessage.card-1',
    sourceItemUuid: 'Actor.caster.Item.spell-1',
    sourceActorUuid: 'Actor.caster',
    casterUuid: 'Actor.caster',
    casting: { casterLevel: 5, source: 'fixed' },
    item: { name: 'Magic', spellLevel: 1 },
    action: { ...action, fingerprint: fingerprintAction(action) },
    targetUuids: [token.uuid],
    targets: [{ uuid: token.uuid, status: 'resolved', name: 'Target' }],
    result: { formula: '1d6', total: 5, attackResults: [] },
    application: { entries: {} }
  };
  const message = {
    uuid: 'ChatMessage.result-1',
    flags: { 'swords-wizardry': { spell: flags } },
    updates: [],
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(changes) {
      this.updates.push(changes);
      if (failMessageUpdate) throw new Error('message update failed');
      applyMessageFlagUpdate(this, changes);
      return this;
    }
  };
  const documents = new Map([[message.uuid, message], [token.uuid, token]]);
  const deps = {
    resolveUuid: async (uuid) => documents.get(uuid) ?? null,
    getCurrentUser: () => ({ id: 'gm-user', isGM }),
    now: () => 123456789
  };
  return { action, actor, token, message, documents, deps };
}

test('GM applies bounded damage once to a synthetic token Actor', async () => {
  const state = fixture();
  const service = new SpellApplicationService(state.deps);
  const first = await service.apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  const second = await service.apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });

  assert.equal(first.status, 'success');
  assert.equal(first.change.newHP, 5);
  assert.equal(state.actor.system.hp.value, 5);
  assert.equal(second.status, 'duplicate');
  assert.equal(state.actor.updates.length, 1);
  assert.equal(Object.keys(state.message.flags['swords-wizardry'].spell.application.entries).length, 1);
});

test('a new result message ignores application state copied from an earlier result', async () => {
  const state = fixture();
  const service = new SpellApplicationService(state.deps);
  const first = await service.apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  assert.equal(first.status, 'success');

  const secondMessage = {
    uuid: 'ChatMessage.result-2',
    flags: structuredClone(state.message.flags),
    updates: [],
    getFlag(scope, key) { return this.flags[scope][key]; },
    async update(changes) {
      this.updates.push(changes);
      applyMessageFlagUpdate(this, changes);
      return this;
    }
  };
  state.documents.set(secondMessage.uuid, secondMessage);

  const second = await service.apply(secondMessage.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });

  assert.equal(second.status, 'success');
  assert.equal(state.actor.system.hp.value, 0);
  assert.equal(state.actor.updates.length, 2);
  assert.equal(
    Object.keys(secondMessage.flags['swords-wizardry'].spell.application.entries).length,
    1
  );
  assert.notEqual(second.application.applicationId, first.application.applicationId);
});

function applyMessageFlagUpdate(message, changes) {
  const spell = message.flags['swords-wizardry'].spell;
  const replacement = changes['flags.swords-wizardry.spell'];
  if (replacement) mergeObject(spell, replacement);

  const entries = spell.application.entries;
  const entriesPath = 'flags.swords-wizardry.spell.application.entries.';
  for (const [path, value] of Object.entries(changes)) {
    if (!path.startsWith(entriesPath)) continue;
    const entryId = path.slice(entriesPath.length);
    if (entryId.startsWith('-=')) {
      delete entries[entryId.slice(2)];
    } else {
      entries[entryId] = structuredClone(value);
    }
  }
}

function mergeObject(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value && typeof value === 'object' && !Array.isArray(value)
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      mergeObject(target[key], value);
    } else {
      target[key] = structuredClone(value);
    }
  }
}

test('non-GM and mismatched operations fail closed without writes', async () => {
  const nonGm = fixture({ isGM: false });
  const nonGmResult = await new SpellApplicationService(nonGm.deps).apply(nonGm.message.uuid, {
    targetUuid: nonGm.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  assert.equal(nonGmResult.code, 'GM_REQUIRED');
  assert.equal(nonGm.actor.updates.length, 0);

  const mismatch = fixture();
  const mismatchResult = await new SpellApplicationService(mismatch.deps).apply(mismatch.message.uuid, {
    targetUuid: mismatch.token.uuid,
    kind: 'healing',
    multiplier: 1
  });
  assert.equal(mismatchResult.code, 'ACTION_KIND_MISMATCH');
  assert.equal(mismatch.actor.updates.length, 0);
});

test('stale fingerprints and deleted targets fail before mutation', async () => {
  const stale = fixture();
  stale.message.flags['swords-wizardry'].spell.action.fingerprint = 'deadbeef';
  const staleResult = await new SpellApplicationService(stale.deps).apply(stale.message.uuid, {
    targetUuid: stale.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  assert.equal(staleResult.code, 'STALE_ACTION');
  assert.equal(stale.actor.updates.length, 0);

  const missing = fixture();
  missing.documents.delete(missing.token.uuid);
  const missingResult = await new SpellApplicationService(missing.deps).apply(missing.message.uuid, {
    targetUuid: missing.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  assert.equal(missingResult.code, 'TARGET_NOT_FOUND');
  assert.equal(missing.actor.updates.length, 0);
});

test('message audit failure compensates the Actor write in reverse order', async () => {
  const state = fixture({ failMessageUpdate: true });
  const result = await new SpellApplicationService(state.deps).apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 0.5
  });

  assert.equal(result.code, 'AUDIT_FAILED_ROLLED_BACK');
  assert.equal(state.actor.system.hp.value, 10);
  assert.deepEqual(state.actor.updates, [
    { 'system.hp.value': 8 },
    { 'system.hp.value': 10 }
  ]);
});

test('failed compensation is reported as an unsafe state', async () => {
  const state = fixture({ failMessageUpdate: true, failRollback: true });
  const result = await new SpellApplicationService(state.deps).apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });

  assert.equal(result.status, 'unsafe');
  assert.equal(result.code, 'ROLLBACK_FAILED');
  assert.equal(state.actor.system.hp.value, 5);
});

test('concurrent duplicate applications perform at most one Actor write', async () => {
  const state = fixture();
  let releaseUpdate;
  const updateStarted = new Promise((resolve) => {
    releaseUpdate = resolve;
  });
  let continueUpdate;
  const updateBlocked = new Promise((resolve) => {
    continueUpdate = resolve;
  });
  state.actor.update = async function(changes) {
    this.updates.push(changes);
    releaseUpdate();
    await updateBlocked;
    this.system.hp.value = changes['system.hp.value'];
    return this;
  };
  const service = new SpellApplicationService(state.deps);
  const firstPromise = service.apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  await updateStarted;
  const second = await service.apply(state.message.uuid, {
    targetUuid: state.token.uuid,
    kind: 'damage',
    multiplier: 1
  });
  continueUpdate();
  const first = await firstPromise;

  assert.equal(first.status, 'success');
  assert.equal(second.code, 'APPLICATION_IN_PROGRESS');
  assert.equal(state.actor.updates.length, 1);
  assert.equal(state.actor.system.hp.value, 5);
});
