import assert from 'node:assert/strict';
import test from 'node:test';

import { SystemSocket } from '../../../module/authority/system-socket.mjs';

class FakeSocket {
  listeners = new Map();
  emissions = [];

  on(namespace, listener) {
    this.listeners.set(namespace, listener);
  }

  off(namespace, listener) {
    if (this.listeners.get(namespace) === listener) this.listeners.delete(namespace);
  }

  async emit(namespace, packet) {
    this.emissions.push({ namespace, packet });
  }

  async receive(packet, senderUserId) {
    return this.listeners.get('system.swords-wizardry')?.(packet, senderUserId);
  }
}

function fixture({ currentUserId = 'gm-active', isActiveGM = true } = {}) {
  const socket = new FakeSocket();
  const calls = [];
  let timerId = 0;
  const timers = new Map();
  const service = new SystemSocket({
    socket,
    getCurrentUser: () => ({
      id: currentUserId,
      isGM: currentUserId.startsWith('gm'),
      isActiveGM
    }),
    getActiveGM: () => ({ id: 'gm-active' }),
    randomId: () => 'request_12345678',
    setTimer(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    operations: {
      'weapon.attack': async (context) => {
        calls.push(context);
        return { status: 'success', code: null, messageUuid: 'ChatMessage.attack1' };
      }
    }
  });
  return { socket, calls, timers, service };
}

test('socket start and stop are idempotent and clean pending requests', async () => {
  const state = fixture({ currentUserId: 'player-1', isActiveGM: false });
  state.service.start();
  state.service.start();
  assert.equal(state.socket.listeners.size, 1);

  const pending = state.service.request('weapon.attack', {
    itemUuid: 'Actor.actor1.Item.weapon1'
  });
  await Promise.resolve();
  assert.equal(state.service.pendingCount, 1);
  assert.equal(state.timers.size, 1);

  state.service.stop();
  state.service.stop();
  assert.equal(state.socket.listeners.size, 0);
  assert.equal(state.service.pendingCount, 0);
  assert.equal(state.timers.size, 0);
  assert.deepEqual(await pending, { status: 'failure', code: 'TRANSPORT_STOPPED' });
});

test('default browser timers retain their required global receiver', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let setCalls = 0;
  let clearCalls = 0;
  globalThis.setTimeout = function setTimeoutWithReceiver() {
    assert.equal(this, globalThis);
    setCalls += 1;
    return 42;
  };
  globalThis.clearTimeout = function clearTimeoutWithReceiver(id) {
    assert.equal(this, globalThis);
    assert.equal(id, 42);
    clearCalls += 1;
  };

  try {
    const socket = new FakeSocket();
    const service = new SystemSocket({
      socket,
      getCurrentUser: () => ({ id: 'player-1', isGM: false, isActiveGM: false }),
      getActiveGM: () => ({ id: 'gm-active' }),
      randomId: () => 'request_12345678',
      operations: {}
    });
    service.start();
    const pending = service.request('weapon.attack', {
      itemUuid: 'Actor.actor1.Item.weapon1'
    });
    await Promise.resolve();
    service.stop();
    assert.deepEqual(await pending, { status: 'failure', code: 'TRANSPORT_STOPPED' });
    assert.equal(setCalls, 1);
    assert.equal(clearCalls, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('active GM dispatch uses the authenticated socket sender, not payload identity', async () => {
  const state = fixture();
  state.service.start();
  await state.socket.receive({
    schemaVersion: 1,
    type: 'request',
    requestId: 'request_12345678',
    operation: 'weapon.attack',
    payload: {
      userId: 'spoofed-user',
      itemUuid: 'Actor.actor1.Item.weapon1'
    }
  }, 'player-1');

  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].senderUserId, 'player-1');
  assert.equal(state.calls[0].payload.userId, 'spoofed-user');
  assert.equal(state.socket.emissions.length, 1);
  assert.equal(state.socket.emissions[0].packet.recipientUserId, 'player-1');
});

test('inactive GM ignores requests and two deliveries execute only on active GM', async () => {
  const active = fixture({ currentUserId: 'gm-active', isActiveGM: true });
  const inactive = fixture({ currentUserId: 'gm-other', isActiveGM: false });
  active.service.start();
  inactive.service.start();
  const request = {
    schemaVersion: 1,
    type: 'request',
    requestId: 'request_12345678',
    operation: 'weapon.attack',
    payload: { itemUuid: 'Actor.actor1.Item.weapon1' }
  };
  await Promise.all([
    active.socket.receive(request, 'player-1'),
    inactive.socket.receive(request, 'player-1')
  ]);
  assert.equal(active.calls.length, 1);
  assert.equal(inactive.calls.length, 0);
});

test('responses resolve only the addressed request and clear timeout state', async () => {
  const state = fixture({ currentUserId: 'player-1', isActiveGM: false });
  state.service.start();
  const pending = state.service.request('weapon.attack', {
    itemUuid: 'Actor.actor1.Item.weapon1'
  });
  await Promise.resolve();

  await state.socket.receive({
    schemaVersion: 1,
    type: 'response',
    requestId: 'request_12345678',
    recipientUserId: 'someone-else',
    result: { status: 'success', code: null }
  }, 'gm-active');
  assert.equal(state.service.pendingCount, 1);

  await state.socket.receive({
    schemaVersion: 1,
    type: 'response',
    requestId: 'request_12345678',
    recipientUserId: 'player-1',
    result: { status: 'success', code: null, messageUuid: 'ChatMessage.attack1' }
  }, 'gm-active');
  assert.deepEqual(await pending, {
    status: 'success', code: null, messageUuid: 'ChatMessage.attack1'
  });
  assert.equal(state.service.pendingCount, 0);
  assert.equal(state.timers.size, 0);
});

test('direct active-GM requests use the same handler path and cache retries', async () => {
  const state = fixture();
  state.service.start();
  const first = await state.service.request('weapon.attack', {
    itemUuid: 'Actor.actor1.Item.weapon1'
  }, { requestId: 'request_12345678' });
  const second = await state.service.request('weapon.attack', {
    itemUuid: 'Actor.actor1.Item.weapon1'
  }, { requestId: 'request_12345678' });

  assert.equal(first.status, 'success');
  assert.deepEqual(second, first);
  assert.equal(state.calls.length, 1);
});
