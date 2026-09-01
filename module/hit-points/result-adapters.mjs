import { validateUuid } from '../authority/domain.mjs';
import { SPELL_MESSAGE_SCHEMA_VERSION } from '../spells/constants.mjs';

const SYSTEM_ID = 'swords-wizardry';
const SCHEMA_VERSION = 1;
const DAMAGE_MODES = Object.freeze({
  fullDamage: Object.freeze({ kind: 'damage', multiplier: 1 }),
  halfDamage: Object.freeze({ kind: 'damage', multiplier: 0.5 }),
  doubleDamage: Object.freeze({ kind: 'damage', multiplier: 2 })
});
const HEALING_MODE = Object.freeze({
  healing: Object.freeze({ kind: 'healing', multiplier: 1 })
});
const WEAPON_MODES = Object.freeze({
  ...DAMAGE_MODES,
  ...HEALING_MODE
});

export async function readHitPointCapability(message, { getUserById } = {}) {
  if (!message?.uuid || typeof getUserById !== 'function') return null;
  const authorId = message.author?.id ?? message.user?.id ?? message.user;
  const author = getUserById(authorId);
  if (!author?.isGM) return null;

  const spell = message.flags?.[SYSTEM_ID]?.spell;
  if (spell) return readSpell(message, spell);
  const weapon = message.flags?.[SYSTEM_ID]?.weapon;
  if (weapon) return readWeapon(message, weapon);
  return null;
}

function readSpell(message, flags) {
  if (
    flags.schemaVersion !== SPELL_MESSAGE_SCHEMA_VERSION
    || flags.messageKind !== 'spell-result'
    || !['damage', 'healing'].includes(flags.action?.kind)
  ) return null;
  const common = readCommon(message, {
    requestedBy: flags.requestedBy,
    sourceActorUuid: flags.sourceActorUuid,
    sourceItemUuid: flags.sourceItemUuid,
    actionId: flags.action?.id,
    actionFingerprint: flags.action?.fingerprint,
    amount: flags.result?.total,
    targetUuids: flags.targetUuids
  });
  if (!common) return null;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    sourceKind: 'spell',
    ...common,
    modes: flags.action.kind === 'healing' ? HEALING_MODE : DAMAGE_MODES
  });
}

function readWeapon(message, flags) {
  if (flags.schemaVersion !== 1 || flags.messageKind !== 'weapon-damage') return null;
  const common = readCommon(message, {
    requestedBy: flags.requestedBy,
    sourceActorUuid: flags.sourceActorUuid,
    sourceItemUuid: flags.sourceItemUuid,
    actionId: flags.actionId,
    actionFingerprint: flags.actionFingerprint,
    amount: flags.result?.total,
    targetUuids: flags.targetUuids
  });
  if (!common) return null;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    sourceKind: 'weapon',
    ...common,
    modes: WEAPON_MODES
  });
}

function readCommon(message, source) {
  const amount = Number(source.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  if (typeof source.requestedBy !== 'string' || !source.requestedBy) return null;
  if (typeof source.actionId !== 'string' || !source.actionId) return null;
  if (typeof source.actionFingerprint !== 'string' || !source.actionFingerprint) return null;
  if (!Array.isArray(source.targetUuids) || source.targetUuids.length > 100) return null;
  try {
    validateUuid(message.uuid);
    validateUuid(source.sourceActorUuid);
    validateUuid(source.sourceItemUuid);
    for (const uuid of source.targetUuids) validateUuid(uuid);
  } catch {
    return null;
  }
  return {
    messageUuid: message.uuid,
    sourceActorUuid: source.sourceActorUuid,
    sourceItemUuid: source.sourceItemUuid,
    requestedBy: source.requestedBy,
    actionId: source.actionId,
    actionFingerprint: source.actionFingerprint,
    amount,
    targetUuids: Object.freeze([...new Set(source.targetUuids)])
  };
}
