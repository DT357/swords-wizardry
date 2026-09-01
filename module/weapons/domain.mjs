export const WEAPON_MESSAGE_SCHEMA_VERSION = 1;

export class WeaponValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'WeaponValidationError';
    this.code = code;
    this.details = details;
  }
}

export function buildWeaponPlan({ item, actor, useAscendingAC }) {
  if (item?.type !== 'weapon' || !item?.uuid) {
    throw new WeaponValidationError('INVALID_WEAPON');
  }
  if (!actor?.uuid) throw new WeaponValidationError('INVALID_ACTOR');
  const damageBase = normalizeFormula(item.system?.damageFormula, 'INVALID_DAMAGE_FORMULA');
  const attackTerms = ['1d20'];
  if (useAscendingAC) appendModifier(attackTerms, actor.system?.tHAACB);
  appendModifier(attackTerms, actor.system?.modifiers?.toHit?.v
    ?? actor.system?.modifiers?.toHit?.value);
  const missile = item.system?.missile === true;
  if (missile) {
    appendModifier(attackTerms, actor.system?.modifiers?.missileToHit?.v
      ?? actor.system?.modifiers?.missileToHit?.value);
  }
  appendModifier(attackTerms, item.system?.modifier);

  const damageTerms = [damageBase];
  appendModifier(damageTerms, actor.system?.modifiers?.damage?.v
    ?? actor.system?.modifiers?.damage?.value);
  const plan = {
    sourceActorUuid: actor.uuid,
    sourceItemUuid: item.uuid,
    attackMode: missile ? 'missile' : 'melee',
    useAscendingAC: useAscendingAC === true,
    attackFormula: attackTerms.join(' + '),
    damageFormula: damageTerms.join(' + '),
    specialDamage: normalizeText(item.system?.specialDamage, 500),
    attacker: {
      tHAC0: finiteOrNull(actor.system?.tHAC0),
      tHAACB: finiteOrNull(actor.system?.tHAACB)
    }
  };
  return deepFreeze(plan);
}

export function fingerprintWeaponPlan(plan) {
  const serialized = canonicalStringify(plan);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function appendModifier(terms, value) {
  if (value === '' || value == null) return;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(number)) {
    throw new WeaponValidationError('INVALID_WEAPON_MODIFIER');
  }
  if (number !== 0) terms.push(String(number));
}

function normalizeFormula(value, code) {
  if (typeof value !== 'string') throw new WeaponValidationError(code);
  const formula = value.trim();
  if (!formula || formula.length > 200) throw new WeaponValidationError(code);
  return formula;
}

function normalizeText(value, max) {
  const text = String(value ?? '').trim();
  return text.slice(0, max);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
