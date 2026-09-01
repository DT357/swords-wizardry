import { parseHitDice } from '../tokens/hit-dice.mjs';

export const MAX_STAT_BLOCK_LENGTH = 20_000;

const LABELS = Object.freeze({
  hd: ['Hit Dice', 'HitDice', 'HD'],
  ac: ['AC'],
  attack: ['Attack', 'Atk', 'ATK'],
  moveRate: ['Movement', 'Move', 'MV', 'MOVE'],
  save: ['Save', 'SV', 'SAVE'],
  morale: ['Morale', 'ML'],
  alignment: ['Alignment', 'AL'],
  clxp: ['CL/XP'],
  hp: ['HP'],
  special: ['Special']
});
const REQUIRED = Object.freeze([
  'hd', 'ac', 'attack', 'moveRate', 'save', 'morale', 'alignment', 'clxp'
]);
const ALIAS_TO_FIELD = new Map();
for (const [field, aliases] of Object.entries(LABELS)) {
  for (const alias of aliases) ALIAS_TO_FIELD.set(alias.toLowerCase(), field);
}
const LABEL_PATTERN = [...ALIAS_TO_FIELD.keys()]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join('|');
const LABEL_REGEX = new RegExp(`(?:^|[;\\s])(${LABEL_PATTERN})\\s*:?\\s*`, 'giu');

export function parseNpcStatBlock(input) {
  const errors = [];
  if (typeof input !== 'string' || input.length > MAX_STAT_BLOCK_LENGTH) {
    return failure('input', 'INVALID_LENGTH');
  }
  const normalized = input.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  const nameMatch = normalized.match(/^([^:]{1,100}):\s*(.*)$/u);
  if (!nameMatch) return failure('name', 'MISSING_NAME');
  const name = nameMatch[1].trim();
  const body = nameMatch[2].trim();
  if (!name) return failure('name', 'MISSING_NAME');

  const { fields, unknownText, duplicates } = extractFields(body);
  for (const field of duplicates) errors.push({ field, code: 'DUPLICATE_FIELD' });
  for (const field of REQUIRED) {
    if (!fields[field]) errors.push({ field, code: 'MISSING_FIELD' });
  }

  let hitDice;
  let attacks;
  let clxp;
  let ac;
  const parsed = {};
  try { hitDice = parseHitDice(fields.hd); } catch { errors.push({ field: 'hd', code: 'INVALID_HIT_DICE' }); }
  try { attacks = parseAttacks(fields.attack); } catch { errors.push({ field: 'attack', code: 'INVALID_ATTACKS' }); }
  try { clxp = parseClXp(fields.clxp); } catch { errors.push({ field: 'clxp', code: 'INVALID_CL_XP' }); }
  try { ac = parseArmorClass(fields.ac); } catch { errors.push({ field: 'ac', code: 'INVALID_ARMOR_CLASS' }); }
  for (const [field, range] of Object.entries({
    moveRate: [0, 1_000], save: [0, 100], morale: [0, 12], hp: [0, 1_000_000]
  })) {
    if (fields[field] == null && field === 'hp') continue;
    try { parsed[field] = parseInteger(fields[field], ...range); }
    catch { errors.push({ field, code: `INVALID_${field.toUpperCase()}` }); }
  }
  if (errors.length) return deepFreeze({ status: 'failure', errors });

  const effectiveHd = Math.min(hitDice.dice, 15);
  const tHAC0 = 19 - effectiveHd;
  const actor = {
    name,
    type: 'npc',
    img: 'systems/swords-wizardry/assets/game-icons-net/cowled.svg',
    system: {
      hd: hitDice.formula,
      hp: { max: parsed.hp ?? 0, value: parsed.hp ?? 0 },
      ac: { value: ac.ac },
      aac: { value: ac.aac },
      tHAC0,
      tHAACB: 19 - tHAC0,
      morale: parsed.morale,
      moveRate: { value: parsed.moveRate },
      save: { value: parsed.save },
      alignment: fields.alignment.trim().toLowerCase(),
      xp: { value: clxp.xp },
      cl: String(clxp.cl),
      special: fields.special?.trim() ?? '',
      description: unknownText
    },
    items: attacks.map(({ name: attackName, formula }) => ({
      name: attackName,
      type: 'weapon',
      system: {
        damageFormula: formula,
        specialDamage: '',
        missile: false,
        modifier: 0,
        quantity: 1,
        weight: 0
      }
    }))
  };
  return deepFreeze({
    status: 'success',
    plan: {
      actor,
      diagnostics: { unknownText }
    }
  });
}

function extractFields(body) {
  const matches = [...body.matchAll(LABEL_REGEX)];
  const fields = {};
  const unknown = [];
  const duplicates = [];
  if (matches.length && body.slice(0, matches[0].index).replace(/[;,.\s]/g, '')) {
    unknown.push(body.slice(0, matches[0].index).trim());
  }
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const field = ALIAS_TO_FIELD.get(match[1].toLowerCase());
    const end = matches[index + 1]?.index ?? body.length;
    const raw = body.slice(match.index + match[0].length, end).trim();
    const segments = raw.split(';').map((entry) => entry.trim()).filter(Boolean);
    const value = (segments.shift() ?? '').replace(/[;.]+$/u, '').trim();
    if (Object.hasOwn(fields, field)) duplicates.push(field);
    else fields[field] = value;
    unknown.push(...segments);
  }
  return {
    fields,
    duplicates,
    unknownText: unknown.join('; ')
  };
}

function parseAttacks(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError();
  const attacks = [];
  const pattern = /\s*([^(),;]+?)\s*\(([^()]+)\)\s*(?:,|$)/gyu;
  let consumed = 0;
  while (consumed < value.length) {
    pattern.lastIndex = consumed;
    const match = pattern.exec(value);
    if (!match) throw new TypeError();
    const name = match[1].trim();
    const formula = match[2].trim();
    if (!name || name.length > 100 || !formula || formula.length > 200) throw new TypeError();
    attacks.push({ name, formula });
    consumed = pattern.lastIndex;
  }
  if (!attacks.length || attacks.length > 32) throw new TypeError();
  return attacks;
}

function parseClXp(value) {
  const match = String(value ?? '').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/u);
  if (!match) throw new TypeError();
  return { cl: parseInteger(match[1], 0, 1_000), xp: parseInteger(match[2], 0, 1_000_000_000) };
}

function parseArmorClass(value) {
  const match = String(value ?? '').match(/^\s*(-?\d+)(?:\s*\[\s*(-?\d+)\s*\])?\s*$/u);
  if (!match) throw new TypeError();
  const ac = parseInteger(match[1], -100, 100);
  const aac = match[2] == null ? 19 - ac : parseInteger(match[2], -100, 100);
  return { ac, aac };
}

function parseInteger(value, minimum, maximum) {
  if (!/^-?\d+$/u.test(String(value ?? '').trim())) throw new TypeError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw new TypeError();
  return number;
}

function failure(field, code) {
  return deepFreeze({ status: 'failure', errors: [{ field, code }] });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
