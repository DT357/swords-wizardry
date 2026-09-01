import {
  AUTHORITY_SOCKET_NAMESPACE,
  AuthorityValidationError,
  createRequestEnvelope,
  createResponseEnvelope,
  validateRequestEnvelope,
  validateResponseEnvelope
} from './domain.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_COMPLETED_REQUESTS = 250;

export class SystemSocket {
  #deps;
  #listener;
  #started = false;
  #pending = new Map();
  #completed = new Map();

  constructor(dependencies) {
    if (!dependencies?.socket?.on || !dependencies?.socket?.off || !dependencies?.socket?.emit) {
      throw new TypeError('SystemSocket requires a socket with on, off, and emit.');
    }
    for (const dependency of ['getCurrentUser', 'getActiveGM', 'randomId']) {
      if (typeof dependencies[dependency] !== 'function') {
        throw new TypeError(`SystemSocket requires ${dependency}.`);
      }
    }
    this.#deps = {
      setTimer: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimer: (timer) => globalThis.clearTimeout(timer),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      operations: {},
      ...dependencies
    };
    this.#listener = (packet, senderUserId) => this.#receive(packet, senderUserId);
  }

  get pendingCount() {
    return this.#pending.size;
  }

  hasActiveGM() {
    return Boolean(this.#deps.getActiveGM()?.id);
  }

  start() {
    if (this.#started) return this;
    this.#deps.socket.on(AUTHORITY_SOCKET_NAMESPACE, this.#listener);
    this.#started = true;
    return this;
  }

  stop() {
    if (this.#started) {
      this.#deps.socket.off(AUTHORITY_SOCKET_NAMESPACE, this.#listener);
      this.#started = false;
    }
    for (const pending of this.#pending.values()) {
      this.#deps.clearTimer(pending.timer);
      pending.resolve(failure('TRANSPORT_STOPPED'));
    }
    this.#pending.clear();
    return this;
  }

  async request(operation, payload = {}, options = {}) {
    if (!this.#started) return failure('TRANSPORT_NOT_STARTED');
    const activeGM = this.#deps.getActiveGM();
    if (!activeGM?.id) return failure('NO_ACTIVE_GM');

    let envelope;
    try {
      envelope = createRequestEnvelope({
        requestId: options.requestId ?? this.#deps.randomId(16),
        operation,
        payload
      });
    } catch (error) {
      return validationFailure(error);
    }

    const currentUser = this.#deps.getCurrentUser();
    if (currentUser?.id === activeGM.id && currentUser?.isActiveGM === true) {
      return this.#dispatch(envelope, currentUser.id);
    }

    if (this.#pending.has(envelope.requestId)) return failure('DUPLICATE_REQUEST_ID');
    const response = new Promise((resolve) => {
      const timer = this.#deps.setTimer(() => {
        this.#pending.delete(envelope.requestId);
        resolve(failure('TRANSPORT_TIMEOUT'));
      }, this.#deps.timeoutMs);
      this.#pending.set(envelope.requestId, { resolve, timer });
    });
    try {
      await this.#deps.socket.emit(AUTHORITY_SOCKET_NAMESPACE, envelope);
    } catch {
      const pending = this.#pending.get(envelope.requestId);
      if (pending) {
        this.#deps.clearTimer(pending.timer);
        this.#pending.delete(envelope.requestId);
        pending.resolve(failure('TRANSPORT_EMIT_FAILED'));
      }
    }
    return response;
  }

  async #receive(packet, senderUserId) {
    if (!this.#started || !packet || typeof packet !== 'object') return;
    if (packet.type === 'response') return this.#receiveResponse(packet, senderUserId);
    if (packet.type !== 'request') return;

    const currentUser = this.#deps.getCurrentUser();
    const activeGM = this.#deps.getActiveGM();
    if (
      currentUser?.isActiveGM !== true
      || !activeGM?.id
      || currentUser.id !== activeGM.id
    ) return;

    let envelope;
    try {
      envelope = validateRequestEnvelope(packet);
    } catch {
      return;
    }
    const result = await this.#dispatch(envelope, senderUserId);
    let response;
    try {
      response = createResponseEnvelope({
        requestId: envelope.requestId,
        recipientUserId: senderUserId,
        result
      });
    } catch {
      response = createResponseEnvelope({
        requestId: envelope.requestId,
        recipientUserId: senderUserId,
        result: failure('INVALID_HANDLER_RESULT')
      });
    }
    await this.#deps.socket.emit(AUTHORITY_SOCKET_NAMESPACE, response);
  }

  #receiveResponse(packet, senderUserId) {
    let response;
    try {
      response = validateResponseEnvelope(packet);
    } catch {
      return;
    }
    const currentUser = this.#deps.getCurrentUser();
    const activeGM = this.#deps.getActiveGM();
    if (
      response.recipientUserId !== currentUser?.id
      || senderUserId !== activeGM?.id
    ) return;
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#deps.clearTimer(pending.timer);
    this.#pending.delete(response.requestId);
    pending.resolve(response.result);
  }

  async #dispatch(envelope, senderUserId) {
    const cacheKey = `${senderUserId}:${envelope.requestId}`;
    if (this.#completed.has(cacheKey)) return this.#completed.get(cacheKey);
    const currentUser = this.#deps.getCurrentUser();
    const activeGM = this.#deps.getActiveGM();
    if (
      currentUser?.isActiveGM !== true
      || !activeGM?.id
      || currentUser.id !== activeGM.id
    ) return failure('NO_ACTIVE_GM');
    const handler = this.#deps.operations[envelope.operation];
    if (typeof handler !== 'function') return failure('UNKNOWN_OPERATION');

    let result;
    try {
      result = await handler({
        requestId: envelope.requestId,
        operation: envelope.operation,
        payload: envelope.payload,
        senderUserId
      });
      if (!result || typeof result !== 'object' || typeof result.status !== 'string') {
        result = failure('INVALID_HANDLER_RESULT');
      }
    } catch (error) {
      result = error instanceof AuthorityValidationError
        ? validationFailure(error)
        : failure('HANDLER_FAILED');
    }
    this.#remember(cacheKey, result);
    return result;
  }

  #remember(key, result) {
    this.#completed.set(key, result);
    while (this.#completed.size > MAX_COMPLETED_REQUESTS) {
      this.#completed.delete(this.#completed.keys().next().value);
    }
  }
}

export function createFoundrySystemSocket(operations) {
  return new SystemSocket({
    socket: game.socket,
    getCurrentUser: () => game.user,
    getActiveGM: () => game.users.activeGM,
    randomId: (length) => foundry.utils.randomID(length),
    operations
  });
}

function validationFailure(error) {
  return failure(error instanceof AuthorityValidationError ? error.code : 'INVALID_REQUEST');
}

function failure(code) {
  return { status: 'failure', code };
}
