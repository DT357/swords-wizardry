import {
  CharacterCreationValidationError,
  buildCharacterSource
} from './domain.mjs';

export class CharacterCreationService {
  #deps;
  #pending = false;

  constructor(dependencies) {
    for (const name of [
      'getCurrentUser', 'getFolderById', 'evaluateRoll', 'createActor'
    ]) {
      if (typeof dependencies?.[name] !== 'function') {
        throw new TypeError(`CharacterCreationService requires ${name}.`);
      }
    }
    this.#deps = dependencies;
  }

  async create({ name, folderId = null }) {
    const user = this.#deps.getCurrentUser();
    if (!user?.can?.('ACTOR_CREATE')) return failure('NOT_AUTHORIZED');
    if (this.#pending) return failure('CREATION_IN_PROGRESS');
    let folder = null;
    if (folderId) {
      folder = this.#deps.getFolderById(folderId);
      if (folder?.type !== 'Actor' || folder.visible === false) return failure('INVALID_FOLDER');
    }

    this.#pending = true;
    try {
      let evaluations;
      try {
        evaluations = await Promise.all(
          Array.from({ length: 7 }, () => this.#deps.evaluateRoll('3d6'))
        );
      } catch {
        return failure('ROLL_FAILED');
      }
      const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha', 'gp'];
      const totals = Object.fromEntries(keys.map((key, index) => (
        [key, evaluations[index]?.total]
      )));
      let source;
      try {
        source = buildCharacterSource({
          name,
          folderId: folder?.id ?? null,
          userId: user.id,
          ownershipLevels: this.#deps.ownershipLevels,
          totals
        });
      } catch (error) {
        return failure(error instanceof CharacterCreationValidationError
          ? error.code
          : 'INVALID_CHARACTER');
      }
      try {
        const actor = await this.#deps.createActor(structuredCopy(source));
        return { status: 'success', code: null, actor };
      } catch {
        return failure('ACTOR_CREATE_FAILED');
      }
    } finally {
      this.#pending = false;
    }
  }
}

export function createFoundryCharacterCreationService() {
  return new CharacterCreationService({
    getCurrentUser: () => game.user,
    getFolderById: (id) => game.folders.get(id),
    async evaluateRoll(formula) {
      const roll = await new Roll(formula).evaluate();
      return { total: roll.total };
    },
    createActor: (source) => Actor.create(source),
    ownershipLevels: {
      none: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      owner: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    }
  });
}

function structuredCopy(value) {
  if (typeof globalThis.structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function failure(code) {
  return { status: 'failure', code };
}
