export class HitDiceValidationError extends Error {
  constructor(code = 'INVALID_HIT_DICE') {
    super(code);
    this.name = 'HitDiceValidationError';
    this.code = code;
  }
}

export function parseHitDice(value) {
  if (typeof value !== 'string' || value.length > 100) {
    throw new HitDiceValidationError();
  }
  const match = value.match(/^\s*(\d+)(?:d(\d+))?(?:\s*([+-])\s*(\d+))?\s*$/i);
  if (!match) throw new HitDiceValidationError();
  const dice = normalizePositiveInteger(match[1]);
  const faces = match[2] == null ? 8 : normalizePositiveInteger(match[2]);
  const magnitude = match[4] == null ? 0 : normalizeNonNegativeInteger(match[4]);
  const modifier = match[3] === '-' ? -magnitude : magnitude;
  const modifierTerm = modifier > 0
    ? ` + ${modifier}`
    : modifier < 0
      ? ` - ${Math.abs(modifier)}`
      : '';
  return Object.freeze({
    dice,
    faces,
    modifier,
    formula: `${dice}d${faces}${modifierTerm}`
  });
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HitDiceValidationError();
  return number;
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new HitDiceValidationError();
  return number;
}
