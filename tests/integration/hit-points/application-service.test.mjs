import assert from 'node:assert/strict';
import test from 'node:test';

import { HitPointApplicationService } from '../../../module/hit-points/application-service.mjs';

function fixture({ failPending = false, failFinalize = false, failTarget = false } = {}) {
  const actor = {
    uuid: 'Actor.target1',
    system: { hp: { value: 10, max: 12 } },
    flags: { 'swords-wizardry': { hitPointApplications: {} } },
    _stats: { modifiedTime: 100 },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      if (failTarget) throw new Error('target failed');
      if (Object.hasOwn(changes, 'system.hp.value')) {
        this.system.hp.value = changes['system.hp.value'];
      }
      applyActorFlagUpdates(this, changes);
      this._stats.modifiedTime += 1;
      return this;
    }
  };
  const message = {
    uuid: 'ChatMessage.result1',
    flags: { 'swords-wizardry': { hitPoints: { schemaVersion: 1, entries: {} } } },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      const entry = Object.values(changes)[0];
      if (entry?.status === 'pending' && failPending) throw new Error('pending failed');
      if (entry?.status === 'applied' && failFinalize) throw new Error('finalize failed');
      applyFlagUpdates(this, changes);
      return this;
    }
  };
  const documents = new Map([[actor.uuid, actor], [message.uuid, message]]);
  const capability = {
    schemaVersion: 1,
    messageUuid: message.uuid,
    sourceKind: 'spell',
    sourceActorUuid: 'Actor.caster1',
    sourceItemUuid: 'Actor.caster1.Item.spell1',
    requestedBy: 'player1',
    actionId: 'damage',
    actionFingerprint: 'fingerprint',
    amount: 5,
    targetUuids: [actor.uuid],
    modes: {
      fullDamage: { kind: 'damage', multiplier: 1 },
      halfDamage: { kind: 'damage', multiplier: 0.5 },
      doubleDamage: { kind: 'damage', multiplier: 2 }
    }
  };
  const service = new HitPointApplicationService({
    resolveUuid: async (uuid) => documents.get(uuid) ?? null,
    readCapability: async (candidate) => candidate === message ? capability : null,
    getCurrentUser: () => ({ id: 'gm1', isGM: true, isActiveGM: true }),
    getUserById: (id) => ({ id, isGM: id === 'gm1' }),
    now: () => 1_000
  });
  return { actor, message, documents, capability, service };
}

test('application writes a pending ledger before Actor HP and then finalizes', async () => {
  const state = fixture();
  const result = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });

  assert.equal(result.status, 'success');
  assert.equal(state.actor.system.hp.value, 5);
  assert.equal(state.message.updates.length, 2);
  assert.equal(Object.values(state.message.updates[0])[0].status, 'pending');
  assert.equal(Object.values(state.message.updates[1])[0].status, 'applied');
  assert.equal(state.actor.updates.length, 1);
  const persisted = JSON.stringify(state.message.flags['swords-wizardry'].hitPoints.entries);
  assert.equal(persisted.includes('oldHP'), false);
  assert.equal(persisted.includes('newHP'), false);
  assert.equal(persisted.includes('"hp"'), false);
});

test('pending audit failure performs no Actor write', async () => {
  const state = fixture({ failPending: true });
  const result = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });
  assert.equal(result.code, 'AUDIT_PENDING_FAILED');
  assert.equal(state.actor.system.hp.value, 10);
  assert.equal(state.actor.updates.length, 0);
});

test('final audit failure leaves applied HP and recoverable pending state without rollback', async () => {
  const state = fixture({ failFinalize: true });
  const first = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });
  assert.equal(first.status, 'pending');
  assert.equal(first.code, 'AUDIT_FINALIZE_FAILED');
  assert.equal(state.actor.system.hp.value, 5);
  assert.equal(state.actor.updates[0]['system.hp.value'], 5);
  assert.equal(Object.keys(state.actor.updates[0]).some((key) => (
    key.startsWith('flags.swords-wizardry.hitPointApplications.')
  )), true);

  const entry = Object.values(state.message.flags['swords-wizardry'].hitPoints.entries)[0];
  assert.equal(entry.status, 'pending');
  state.message.update = async function(changes) {
    this.updates.push(structuredClone(changes));
    applyFlagUpdates(this, changes);
    return this;
  };
  const recovered = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });
  assert.equal(recovered.status, 'success');
  assert.equal(recovered.recovered, true);
  assert.equal(state.actor.updates.length, 1);
});

test('changed target state makes a pending application conflict instead of guessing', async () => {
  const state = fixture({ failTarget: true });
  const failed = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });
  assert.equal(failed.code, 'TARGET_UPDATE_FAILED');
  state.actor.update = async function(changes) {
    this.updates.push(structuredClone(changes));
    if (Object.hasOwn(changes, 'system.hp.value')) {
      this.system.hp.value = changes['system.hp.value'];
    }
    applyActorFlagUpdates(this, changes);
    this._stats.modifiedTime += 1;
    return this;
  };
  state.actor.system.hp.value = 7;
  state.actor._stats.modifiedTime += 1;
  const result = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'fullDamage',
    requestedBy: 'gm1'
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.code, 'TARGET_STATE_CONFLICT');
  assert.equal(state.actor.updates.length, 1);
});

test('duplicate and concurrent requests perform at most one Actor write', async () => {
  const state = fixture();
  const first = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'halfDamage',
    requestedBy: 'gm1'
  });
  const duplicate = await state.service.applyAuthorized({
    messageUuid: state.message.uuid,
    targetUuid: state.actor.uuid,
    mode: 'doubleDamage',
    requestedBy: 'gm1'
  });
  assert.equal(first.status, 'success');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(state.actor.updates.length, 1);
});

test('socket apply handler requires an authenticated GM and exact payload', async () => {
  const state = fixture();
  const denied = await state.service.handleApply({
    senderUserId: 'player1',
    payload: {
      messageUuid: state.message.uuid,
      targetUuid: state.actor.uuid,
      mode: 'fullDamage'
    }
  });
  assert.equal(denied.code, 'NOT_AUTHORIZED');
  assert.equal(state.actor.updates.length, 0);

  const accepted = await state.service.handleApply({
    senderUserId: 'gm1',
    payload: {
      messageUuid: state.message.uuid,
      targetUuid: state.actor.uuid,
      mode: 'fullDamage'
    }
  });
  assert.equal(accepted.status, 'success');
});

function applyFlagUpdates(message, changes) {
  const prefix = 'flags.swords-wizardry.hitPoints.entries.';
  for (const [path, value] of Object.entries(changes)) {
    if (path.startsWith(prefix)) {
      message.flags['swords-wizardry'].hitPoints.entries[path.slice(prefix.length)]
        = structuredClone(value);
    }
  }
}

function applyActorFlagUpdates(actor, changes) {
  const prefix = 'flags.swords-wizardry.hitPointApplications.';
  for (const [path, value] of Object.entries(changes)) {
    if (path.startsWith(prefix)) {
      actor.flags['swords-wizardry'].hitPointApplications[path.slice(prefix.length)]
        = structuredClone(value);
    }
  }
}
