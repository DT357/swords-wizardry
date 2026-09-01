import {
  HIT_POINT_LEDGER_SCHEMA_VERSION,
  HitPointValidationError,
  calculateHitPointChange,
  classifyPendingApplication,
  createApplicationId,
  createTargetFingerprint,
  redactTargetFingerprint,
  validateApplyPayload
} from './domain.mjs';

const SYSTEM_ID = 'swords-wizardry';
const LEDGER_FLAG = 'hitPoints';

export class HitPointApplicationService {
  #deps;
  #locks = new Set();

  constructor(dependencies) {
    for (const dependency of [
      'resolveUuid', 'readCapability', 'getCurrentUser', 'getUserById'
    ]) {
      if (typeof dependencies?.[dependency] !== 'function') {
        throw new TypeError(`HitPointApplicationService requires ${dependency}.`);
      }
    }
    this.#deps = { now: () => Date.now(), ...dependencies };
  }

  async handleApply({ senderUserId, payload }) {
    const sender = this.#deps.getUserById(senderUserId);
    if (!sender?.isGM) return failure('NOT_AUTHORIZED');
    const result = await this.applyAuthorized({ ...payload, requestedBy: senderUserId });
    return safeResult(result);
  }

  async applyAuthorized({ messageUuid, targetUuid, mode, requestedBy }) {
    const currentUser = this.#deps.getCurrentUser();
    if (!currentUser?.isGM || currentUser?.isActiveGM !== true) {
      return failure('NO_ACTIVE_GM');
    }

    let request;
    try {
      request = validateApplyPayload({ messageUuid, targetUuid, mode });
    } catch (error) {
      return validationFailure(error);
    }

    const applicationId = createApplicationId(request);
    if (this.#locks.has(applicationId)) return failure('APPLICATION_IN_PROGRESS');
    this.#locks.add(applicationId);
    try {
      return await this.#apply(request, requestedBy, applicationId);
    } catch (error) {
      return error instanceof HitPointValidationError
        ? validationFailure(error)
        : failure('APPLICATION_FAILED');
    } finally {
      this.#locks.delete(applicationId);
    }
  }

  async #apply(request, requestedBy, applicationId) {
    let message = await this.#deps.resolveUuid(request.messageUuid);
    if (!message) return failure('MESSAGE_NOT_FOUND');
    const capability = await this.#deps.readCapability(message);
    if (!capability || capability.messageUuid !== message.uuid) {
      return failure('INVALID_RESULT_CAPABILITY');
    }
    if (!capability.targetUuids?.includes(request.targetUuid)) {
      return failure('TARGET_NOT_ALLOWED');
    }
    if (!capability.modes?.[request.mode]) return failure('MODE_NOT_ALLOWED');

    let target = await this.#deps.resolveUuid(request.targetUuid);
    let actor = resolveActor(target);
    if (!actor) return failure('TARGET_NOT_FOUND');

    const existing = readLedgerEntry(message, applicationId);
    if (existing?.status === 'applied') {
      return { status: 'duplicate', code: 'ALREADY_APPLIED', applicationId };
    }
    if (existing?.status === 'conflict') {
      return { status: 'conflict', code: 'TARGET_STATE_CONFLICT', applicationId };
    }
    if (existing?.status === 'pending') {
      const current = createTargetFingerprint({ targetUuid: request.targetUuid, actor });
      const recovery = classifyPendingApplication(existing, current, {
        appliedMarker: hasApplicationMarker(actor, applicationId, message.uuid)
      });
      if (recovery === 'applied') {
        const finalized = {
          ...existing,
          status: 'applied',
          after: redactTargetFingerprint(current),
          finalizedAt: this.#deps.now()
        };
        try {
          await writeLedgerEntry(message, applicationId, finalized);
        } catch {
          return { status: 'pending', code: 'AUDIT_FINALIZE_FAILED', applicationId };
        }
        return { status: 'success', code: null, applicationId, recovered: true };
      }
      if (recovery === 'conflict') {
        const conflicted = {
          ...existing,
          status: 'conflict',
          conflictAt: this.#deps.now()
        };
        try {
          await writeLedgerEntry(message, applicationId, conflicted);
        } catch {
          // The already-persisted pending entry remains the recoverable source of truth.
        }
        return { status: 'conflict', code: 'TARGET_STATE_CONFLICT', applicationId };
      }
    }

    const definition = capability.modes[request.mode];
    const change = calculateHitPointChange({
      mode: request.mode,
      current: actor.system?.hp?.value,
      maximum: actor.system?.hp?.max,
      amount: capability.amount
    });
    if (
      change.kind !== definition.kind
      || change.multiplier !== definition.multiplier
    ) return failure('MODE_DEFINITION_MISMATCH');

    const beforeFingerprint = createTargetFingerprint({
      targetUuid: request.targetUuid,
      actor
    });
    const before = existing?.before ?? redactTargetFingerprint(beforeFingerprint);
    const publicChange = {
      kind: change.kind,
      multiplier: change.multiplier,
      requestedAmount: change.requestedAmount,
      appliedAmount: change.appliedAmount
    };
    const pending = existing ?? {
      schemaVersion: HIT_POINT_LEDGER_SCHEMA_VERSION,
      applicationId,
      status: 'pending',
      messageUuid: message.uuid,
      targetUuid: request.targetUuid,
      sourceKind: capability.sourceKind,
      actionId: capability.actionId,
      mode: request.mode,
      requestedBy,
      before,
      change: publicChange,
      pendingAt: this.#deps.now()
    };

    if (!existing) {
      try {
        await writeLedgerEntry(message, applicationId, pending);
      } catch {
        return failure('AUDIT_PENDING_FAILED');
      }
    }

    message = await this.#deps.resolveUuid(request.messageUuid);
    target = await this.#deps.resolveUuid(request.targetUuid);
    actor = resolveActor(target);
    if (!message || !actor) return failure('TARGET_NOT_FOUND');
    const immediatelyBefore = createTargetFingerprint({
      targetUuid: request.targetUuid,
      actor
    });
    if (!sameFingerprint(beforeFingerprint, immediatelyBefore)) {
      const conflicted = {
        ...pending,
        status: 'conflict',
        conflictAt: this.#deps.now()
      };
      try {
        await writeLedgerEntry(message, applicationId, conflicted);
      } catch {
        // Pending audit remains for a later recovery attempt.
      }
      return { status: 'conflict', code: 'TARGET_STATE_CONFLICT', applicationId };
    }

    const actorUpdate = {
      [`flags.${SYSTEM_ID}.hitPointApplications.${applicationId}`]: {
        messageUuid: message.uuid,
        targetUuid: request.targetUuid
      }
    };
    if (change.newHP !== change.oldHP) {
      actorUpdate['system.hp.value'] = change.newHP;
    }
    try {
      await actor.update(actorUpdate);
    } catch {
      return failure('TARGET_UPDATE_FAILED');
    }

    const after = redactTargetFingerprint(createTargetFingerprint({
      targetUuid: request.targetUuid,
      actor
    }));
    const applied = {
      ...pending,
      status: 'applied',
      after,
      appliedBy: currentUserId(this.#deps.getCurrentUser()),
      finalizedAt: this.#deps.now()
    };
    try {
      await writeLedgerEntry(message, applicationId, applied);
    } catch {
      return { status: 'pending', code: 'AUDIT_FINALIZE_FAILED', applicationId };
    }
    return { status: 'success', code: null, applicationId, recovered: false };
  }
}

export function createFoundryHitPointApplicationService(readCapability) {
  const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
  return new HitPointApplicationService({
    resolveUuid: (uuid) => resolveUuid(uuid),
    readCapability,
    getCurrentUser: () => game.user,
    getUserById: (id) => game.users.get(id),
    now: () => Date.now()
  });
}

function readLedgerEntry(message, applicationId) {
  return message.flags?.[SYSTEM_ID]?.[LEDGER_FLAG]?.entries?.[applicationId] ?? null;
}

function writeLedgerEntry(message, applicationId, entry) {
  return message.update({
    [`flags.${SYSTEM_ID}.${LEDGER_FLAG}.entries.${applicationId}`]: entry
  });
}

function resolveActor(document) {
  if (document?.actor) return document.actor;
  return document?.documentName === 'Actor' || document?.uuid?.startsWith('Actor.')
    ? document
    : null;
}

function sameFingerprint(left, right) {
  return left.targetUuid === right.targetUuid
    && left.actorUuid === right.actorUuid
    && left.hp === right.hp
    && left.modifiedTime === right.modifiedTime;
}

function hasApplicationMarker(actor, applicationId, messageUuid) {
  return actor.flags?.[SYSTEM_ID]?.hitPointApplications?.[applicationId]?.messageUuid
    === messageUuid;
}

function currentUserId(user) {
  return typeof user?.id === 'string' ? user.id : null;
}

function safeResult(result) {
  return {
    status: result.status,
    code: result.code ?? null,
    applicationId: result.applicationId ?? null
  };
}

function validationFailure(error) {
  return failure(error instanceof HitPointValidationError ? error.code : 'INVALID_REQUEST');
}

function failure(code) {
  return { status: 'failure', code };
}
