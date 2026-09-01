export class DerivedFieldValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DerivedFieldValidationError';
    this.code = code;
  }
}

export function synchronizeDerivedFields(current, changed, options = {}) {
  if (!changed || typeof changed !== 'object') return changed;
  synchronizePair({
    changed,
    leftPath: ['tHAACB'],
    rightPath: ['tHAC0'],
    leftName: 'system.tHAACB',
    rightName: 'system.tHAC0',
    deriveRight: (value) => 19 - value,
    deriveLeft: (value) => 19 - value,
    code: 'INCONSISTENT_ATTACK_MATRIX',
    changedField: options.swordsWizardry?.changedField
  });
  synchronizePair({
    changed,
    leftPath: ['ac', 'value'],
    rightPath: ['aac', 'value'],
    leftName: 'system.ac.value',
    rightName: 'system.aac.value',
    deriveRight: (value) => 19 - value,
    deriveLeft: (value) => 19 - value,
    code: 'INCONSISTENT_ARMOR_CLASS',
    changedField: options.swordsWizardry?.changedField
  });
  return changed;
}

function synchronizePair({
  changed, leftPath, rightPath, leftName, rightName,
  deriveRight, deriveLeft, code, changedField
}) {
  const hasLeft = hasPath(changed, leftPath);
  const hasRight = hasPath(changed, rightPath);
  if (!hasLeft && !hasRight) return;
  if (hasLeft && !hasRight) {
    setPath(changed, rightPath, deriveRight(readNumber(changed, leftPath, code)));
    return;
  }
  if (!hasLeft && hasRight) {
    setPath(changed, leftPath, deriveLeft(readNumber(changed, rightPath, code)));
    return;
  }
  const left = readNumber(changed, leftPath, code);
  const right = readNumber(changed, rightPath, code);
  if (deriveRight(left) === right) return;
  if (changedField === leftName) {
    setPath(changed, rightPath, deriveRight(left));
    return;
  }
  if (changedField === rightName) {
    setPath(changed, leftPath, deriveLeft(right));
    return;
  }
  throw new DerivedFieldValidationError(code);
}

function hasPath(object, path) {
  let current = object;
  for (const part of path) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return false;
    current = current[part];
  }
  return true;
}

function readNumber(object, path, code) {
  let value = object;
  for (const part of path) value = value[part];
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isSafeInteger(number)) {
    throw new DerivedFieldValidationError(code);
  }
  return number;
}

function setPath(object, path, value) {
  let current = object;
  for (const part of path.slice(0, -1)) current = current[part] ??= {};
  current[path.at(-1)] = value;
}
