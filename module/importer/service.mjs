import { parseNpcStatBlock } from './domain.mjs';

export class ImportService {
  #deps;
  #pending = false;

  constructor(dependencies) {
    for (const name of ['getCurrentUser', 'validateRollFormula', 'createActor']) {
      if (typeof dependencies?.[name] !== 'function') {
        throw new TypeError(`ImportService requires ${name}.`);
      }
    }
    this.#deps = dependencies;
  }

  async import(text) {
    if (!this.#deps.getCurrentUser()?.isGM) return failure('NOT_AUTHORIZED');
    if (this.#pending) return failure('IMPORT_IN_PROGRESS');
    const parsed = parseNpcStatBlock(text);
    if (parsed.status !== 'success') {
      return { status: 'failure', code: 'INVALID_STAT_BLOCK', errors: parsed.errors };
    }
    for (const item of parsed.plan.actor.items) {
      if (!this.#deps.validateRollFormula(item.system.damageFormula)) {
        return failure('INVALID_ATTACK_FORMULA');
      }
    }

    this.#pending = true;
    try {
      const actor = await this.#deps.createActor(
        structuredCopy(parsed.plan.actor),
        { renderSheet: true }
      );
      return {
        status: 'success',
        code: null,
        actor,
        diagnostics: parsed.plan.diagnostics
      };
    } catch {
      return failure('ACTOR_CREATE_FAILED');
    } finally {
      this.#pending = false;
    }
  }
}

export function createFoundryImportService() {
  return new ImportService({
    getCurrentUser: () => game.user,
    validateRollFormula: (formula) => Roll.validate(formula),
    createActor: (source, options) => Actor.create(source, options)
  });
}

function structuredCopy(value) {
  if (typeof globalThis.structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function failure(code) {
  return { status: 'failure', code };
}
