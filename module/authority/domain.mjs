export const AUTHORITY_SCHEMA_VERSION = 1;
export const AUTHORITY_SOCKET_NAMESPACE = 'system.swords-wizardry';
export const AUTHORITY_OPERATIONS = Object.freeze([
  'weapon.attack',
  'weapon.damage',
  'spell.hitPointResult',
  'spell.consume',
  'hitPoints.apply',
  'morale.roll'
]);

const REQUEST_FIELDS = Object.freeze([
  'schemaVersion', 'type', 'requestId', 'operation', 'payload'
]);
const RESPONSE_FIELDS = Object.freeze([
  'schemaVersion', 'type', 'requestId', 'recipientUserId', 'result'
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const UUID_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UUID_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_ENVELOPE_BYTES = 32_768;

export class AuthorityValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'AuthorityValidationError';
    this.code = code;
    this.details = details;
  }
}

export function createRequestEnvelope({ requestId, operation, payload = {} }) {
  return validateRequestEnvelope({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    type: 'request',
    requestId,
    operation,
    payload: structuredCopy(payload)
  });
}

export function createResponseEnvelope({ requestId, recipientUserId, result }) {
  return validateResponseEnvelope({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    type: 'response',
    requestId,
    recipientUserId,
    result: structuredCopy(result)
  });
}

export function validateRequestEnvelope(value) {
  assertPlainObject(value, 'INVALID_ENVELOPE');
  assertExactFields(value, REQUEST_FIELDS, 'INVALID_ENVELOPE_FIELDS');
  assertEnvelopeSize(value);
  if (value.schemaVersion !== AUTHORITY_SCHEMA_VERSION) {
    throw new AuthorityValidationError('UNSUPPORTED_SCHEMA');
  }
  if (value.type !== 'request') throw new AuthorityValidationError('INVALID_MESSAGE_TYPE');
  validateRequestId(value.requestId);
  if (!AUTHORITY_OPERATIONS.includes(value.operation)) {
    throw new AuthorityValidationError('UNKNOWN_OPERATION');
  }
  assertPlainObject(value.payload, 'INVALID_PAYLOAD');
  return deepFreeze(structuredCopy(value));
}

export function validateResponseEnvelope(value) {
  assertPlainObject(value, 'INVALID_ENVELOPE');
  assertExactFields(value, RESPONSE_FIELDS, 'INVALID_ENVELOPE_FIELDS');
  assertEnvelopeSize(value);
  if (value.schemaVersion !== AUTHORITY_SCHEMA_VERSION) {
    throw new AuthorityValidationError('UNSUPPORTED_SCHEMA');
  }
  if (value.type !== 'response') throw new AuthorityValidationError('INVALID_MESSAGE_TYPE');
  validateRequestId(value.requestId);
  validateUserId(value.recipientUserId);
  assertPlainObject(value.result, 'INVALID_RESULT');
  if (typeof value.result.status !== 'string' || !value.result.status) {
    throw new AuthorityValidationError('INVALID_RESULT');
  }
  return deepFreeze(structuredCopy(value));
}

export function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw new AuthorityValidationError('INVALID_REQUEST_ID');
  }
  return value;
}

export function validateUserId(value) {
  if (typeof value !== 'string' || !value || value.length > 128) {
    throw new AuthorityValidationError('INVALID_USER_ID');
  }
  return value;
}

export function validateUuid(value, code = 'INVALID_UUID') {
  if (typeof value !== 'string' || value.length > 512 || !isFoundryUuid(value)) {
    throw new AuthorityValidationError(code);
  }
  return value;
}

function isFoundryUuid(value) {
  const parts = value.split('.');
  let pairStart = 0;
  if (parts[0] === 'Compendium') {
    if (
      parts.length < 5
      || !UUID_ID_PATTERN.test(parts[1])
      || !UUID_ID_PATTERN.test(parts[2])
    ) return false;
    pairStart = 3;
  }
  if (parts.length - pairStart < 2 || (parts.length - pairStart) % 2 !== 0) {
    return false;
  }
  for (let index = pairStart; index < parts.length; index += 2) {
    if (
      !UUID_TYPE_PATTERN.test(parts[index])
      || !UUID_ID_PATTERN.test(parts[index + 1])
    ) return false;
  }
  return true;
}

export function assertExactFields(value, allowedFields, code = 'UNKNOWN_FIELDS') {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new AuthorityValidationError(code, { unknown });
  for (const field of allowed) {
    if (!Object.hasOwn(value, field)) {
      throw new AuthorityValidationError(code, { missing: field });
    }
  }
  return value;
}

export function assertPlainObject(value, code = 'INVALID_OBJECT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuthorityValidationError(code);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AuthorityValidationError(code);
  }
  return value;
}

function assertEnvelopeSize(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AuthorityValidationError('UNSERIALIZABLE_ENVELOPE');
  }
  if (serialized.length > MAX_ENVELOPE_BYTES) {
    throw new AuthorityValidationError('ENVELOPE_TOO_LARGE');
  }
}

function structuredCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new AuthorityValidationError('UNSERIALIZABLE_ENVELOPE');
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
