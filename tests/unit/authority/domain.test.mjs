import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthorityValidationError,
  AUTHORITY_OPERATIONS,
  createRequestEnvelope,
  createResponseEnvelope,
  validateRequestEnvelope,
  validateResponseEnvelope,
  validateUuid
} from '../../../module/authority/domain.mjs';

const REQUEST_ID = 'request_12345678';

test('authority request envelopes keep transport fields outside caller payload control', () => {
  const envelope = createRequestEnvelope({
    requestId: REQUEST_ID,
    operation: 'weapon.attack',
    payload: {
      requestId: 'spoofed_request',
      userId: 'spoofed-user',
      itemUuid: 'Actor.actor1.Item.item1'
    }
  });

  assert.deepEqual(envelope, {
    schemaVersion: 1,
    type: 'request',
    requestId: REQUEST_ID,
    operation: 'weapon.attack',
    payload: {
      requestId: 'spoofed_request',
      userId: 'spoofed-user',
      itemUuid: 'Actor.actor1.Item.item1'
    }
  });
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.payload), true);
});

test('authority envelope validation rejects unknown fields, operations, versions, and size abuse', () => {
  const valid = createRequestEnvelope({
    requestId: REQUEST_ID,
    operation: 'spell.consume',
    payload: { messageUuid: 'ChatMessage.message1' }
  });
  assert.deepEqual(validateRequestEnvelope(valid), valid);

  for (const candidate of [
    { ...valid, extra: true },
    { ...valid, schemaVersion: 2 },
    { ...valid, type: 'response' },
    { ...valid, requestId: 'short' },
    { ...valid, operation: 'actor.update' },
    { ...valid, payload: [] },
    { ...valid, payload: { value: 'x'.repeat(33_000) } }
  ]) {
    assert.throws(
      () => validateRequestEnvelope(candidate),
      AuthorityValidationError
    );
  }
});

test('authority responses are addressed, bounded, and schema validated', () => {
  const response = createResponseEnvelope({
    requestId: REQUEST_ID,
    recipientUserId: 'player-1',
    result: { status: 'success', code: null, messageUuid: 'ChatMessage.result1' }
  });
  assert.deepEqual(validateResponseEnvelope(response), response);
  assert.throws(
    () => validateResponseEnvelope({ ...response, recipientUserId: '' }),
    AuthorityValidationError
  );
  assert.throws(
    () => validateResponseEnvelope({ ...response, secret: 'nope' }),
    AuthorityValidationError
  );
});

test('the operation allowlist is exact and immutable', () => {
  assert.deepEqual([...AUTHORITY_OPERATIONS], [
    'weapon.attack',
    'weapon.damage',
    'spell.hitPointResult',
    'spell.consume',
    'hitPoints.apply',
    'morale.roll'
  ]);
  assert.equal(Object.isFrozen(AUTHORITY_OPERATIONS), true);
});

test('UUID validation accepts Foundry UUIDs and rejects ambiguous identifiers', () => {
  for (const uuid of [
    'Actor.actor1',
    'Actor.1actor',
    'Actor.actor1.Item.item1',
    'Actor.actor1.Item.1item',
    'Scene.scene1.Token.token1',
    'Scene.20bCEvo3nT29H2pu.Token.0token',
    'Compendium.swords-wizardry.spells.Item.1item',
    'ChatMessage.message1'
  ]) {
    assert.equal(validateUuid(uuid), uuid);
  }
  for (const value of [
    '', 'actor1', '../Actor.actor1', 'Actor.actor 1', 'Actor.id.Item',
    'Compendium.scope.pack.id', 1, null
  ]) {
    assert.throws(() => validateUuid(value), AuthorityValidationError);
  }
});
