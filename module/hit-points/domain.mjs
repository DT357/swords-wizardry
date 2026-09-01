import { validateUuid } from '../authority/domain.mjs';

export const HIT_POINT_LEDGER_SCHEMA_VERSION = 1;
export const HIT_POINT_MODES = Object.freeze({
  fullDamage: Object.freeze({ kind: 'damage', multiplier: 1 }),
  halfDamage: Object.freeze({ kind: 'damage', multiplier: 0.5 }),
  doubleDamage: Object.freeze({ kind: 'damage', multiplier: 2 }),
  healing: Object.freeze({ kind: 'healing', multiplier: 1 })
});
export const MAX_HIT_POINT_AMOUNT = 1_000_000;

const APPLY_FIELDS = Object.freeze(['messageUuid', 'targetUuid', 'mode']);

export class HitPointValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'HitPointValidationError';
    this.code = code;
    this.details = details;
  }
}

export function calculateHitPointChange({ mode, current, maximum, amount }) {
  const definition = HIT_POINT_MODES[mode];
  if (!definition) throw new HitPointValidationError('INVALID_HP_MODE');
  const oldHP = nonNegativeInteger(current, 'INVALID_CURRENT_HP');
  const maximumHP = nonNegativeInteger(maximum, 'INVALID_MAXIMUM_HP');
  const numericAmount = Number(amount);
  if (
    !Number.isFinite(numericAmount)
    || numericAmount < 0
    || numericAmount > MAX_HIT_POINT_AMOUNT
  ) throw new HitPointValidationError('INVALID_HP_AMOUNT');

  const requestedAmount = Math.floor(numericAmount * definition.multiplier);
  const newHP = definition.kind === 'damage'
    ? Math.max(0, oldHP - requestedAmount)
    : Math.max(oldHP, Math.min(maximumHP, oldHP + requestedAmount));
  return {
    kind: definition.kind,
    multiplier: definition.multiplier,
    oldHP,
    newHP,
    requestedAmount,
    appliedAmount: Math.abs(newHP - oldHP)
  };
}

export function createApplicationId({ messageUuid, targetUuid }) {
  const source = `${validateFoundryUuid(messageUuid)}\u0000${validateFoundryUuid(targetUuid)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `hp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createTargetFingerprint({ targetUuid, actor }) {
  if (!actor?.uuid) throw new HitPointValidationError('TARGET_NOT_FOUND');
  return Object.freeze({
    targetUuid: validateFoundryUuid(targetUuid),
    actorUuid: validateFoundryUuid(actor.uuid),
    hp: nonNegativeInteger(actor.system?.hp?.value, 'INVALID_CURRENT_HP'),
    modifiedTime: normalizeModifiedTime(actor._stats?.modifiedTime)
  });
}

export function redactTargetFingerprint(fingerprint) {
  return Object.freeze({
    targetUuid: validateFoundryUuid(fingerprint?.targetUuid),
    actorUuid: validateFoundryUuid(fingerprint?.actorUuid),
    modifiedTime: normalizeModifiedTime(fingerprint?.modifiedTime)
  });
}

export function classifyPendingApplication(entry, current, { appliedMarker = false } = {}) {
  if (!entry?.before || !sameIdentity(entry.before, current)) return 'conflict';
  if (appliedMarker) return 'applied';
  if (entry.before.modifiedTime == null || current.modifiedTime == null) return 'conflict';
  return entry.before.modifiedTime === current.modifiedTime ? 'retry' : 'conflict';
}

export function validateApplyPayload(value) {
  if (!isPlainObject(value)) throw new HitPointValidationError('INVALID_REQUEST');
  assertExactFields(value, APPLY_FIELDS);
  const mode = String(value.mode ?? '');
  if (!HIT_POINT_MODES[mode]) throw new HitPointValidationError('INVALID_HP_MODE');
  return Object.freeze({
    messageUuid: validateFoundryUuid(value.messageUuid),
    targetUuid: validateFoundryUuid(value.targetUuid),
    mode
  });
}

function sameIdentity(expected, actual) {
  return expected.targetUuid === actual.targetUuid && expected.actorUuid === actual.actorUuid;
}

function normalizeModifiedTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nonNegativeInteger(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new HitPointValidationError(code);
  return number;
}

function validateFoundryUuid(value) {
  try {
    return validateUuid(value);
  } catch {
    throw new HitPointValidationError('INVALID_UUID');
  }
}

function assertExactFields(value, fields) {
  const allowed = new Set(fields);
  if (
    Object.keys(value).some((key) => !allowed.has(key))
    || fields.some((field) => !Object.hasOwn(value, field))
  ) throw new HitPointValidationError('INVALID_REQUEST_FIELDS');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
