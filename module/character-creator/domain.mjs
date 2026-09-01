export class CharacterCreationValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CharacterCreationValidationError';
    this.code = code;
  }
}

export function buildCharacterSource({
  name, folderId, userId, ownershipLevels, totals
}) {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName || normalizedName.length > 100) {
    throw new CharacterCreationValidationError('INVALID_NAME');
  }
  if (typeof userId !== 'string' || !userId) {
    throw new CharacterCreationValidationError('INVALID_USER');
  }
  const values = {};
  for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha', 'gp']) {
    const value = Number(totals?.[key]);
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
      throw new CharacterCreationValidationError('INVALID_ROLL_RESULT');
    }
    values[key] = value;
  }
  return Object.freeze({
    name: normalizedName,
    type: 'character',
    img: 'systems/swords-wizardry/assets/game-icons-net/cowled.svg',
    folder: folderId || null,
    ownership: {
      default: ownershipLevels.none,
      [userId]: ownershipLevels.owner
    },
    system: {
      abilities: {
        str: { value: values.str },
        dex: { value: values.dex },
        con: { value: values.con },
        int: { value: values.int },
        wis: { value: values.wis },
        cha: { value: values.cha }
      },
      treasure: { gp: values.gp * 10 }
    }
  });
}
