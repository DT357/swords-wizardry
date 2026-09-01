export const ROLL_MODES = Object.freeze([
  'publicroll', 'gmroll', 'blindroll', 'selfroll'
]);

const ROLL_MODE_ALIASES = Object.freeze({
  public: 'publicroll',
  gm: 'gmroll',
  blind: 'blindroll',
  self: 'selfroll'
});

export class RollValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RollValidationError';
    this.code = code;
  }
}

export function normalizeRollMode(value) {
  const normalized = ROLL_MODE_ALIASES[value] ?? value;
  if (!ROLL_MODES.includes(normalized)) throw new RollValidationError('INVALID_ROLL_MODE');
  return normalized;
}

export function normalizeFeatureFormula(value) {
  if (typeof value !== 'string') throw new RollValidationError('INVALID_ROLL_FORMULA');
  const formula = value.trim();
  if (!formula) return null;
  if (formula.length > 200) throw new RollValidationError('INVALID_ROLL_FORMULA');
  return formula;
}

export function evaluateThreshold({ total, target, targetType }) {
  const rollTotal = Number(total);
  const targetNumber = Number(target);
  if (!Number.isFinite(rollTotal) || !Number.isSafeInteger(targetNumber)) {
    throw new RollValidationError('INVALID_ROLL_RESULT');
  }
  if (!['ascending', 'descending'].includes(targetType)) {
    throw new RollValidationError('INVALID_TARGET_TYPE');
  }
  return Object.freeze({
    target: targetNumber,
    targetType,
    success: targetType === 'ascending'
      ? rollTotal >= targetNumber
      : rollTotal <= targetNumber
  });
}
