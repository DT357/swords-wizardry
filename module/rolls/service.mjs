import { validateUuid } from '../authority/domain.mjs';
import {
  applyFoundryChatVisibility,
  readFoundryRollMode
} from './chat-visibility.mjs';
import {
  RollValidationError,
  evaluateThreshold,
  normalizeFeatureFormula,
  normalizeRollMode
} from './domain.mjs';

const SYSTEM_ID = 'swords-wizardry';
const ABILITY_TEMPLATE = `systems/${SYSTEM_ID}/module/rolls/ability-roll-sheet.hbs`;
const SAVE_TEMPLATE = `systems/${SYSTEM_ID}/module/rolls/save-roll-sheet.hbs`;
const FEATURE_TEMPLATE = `systems/${SYSTEM_ID}/module/rolls/feature-roll-sheet.hbs`;
const MORALE_TEMPLATE = `systems/${SYSTEM_ID}/module/rolls/morale-roll-sheet.hbs`;
const FEATURE_ICON = `systems/${SYSTEM_ID}/assets/game-icons-net/skills.svg`;
const MORALE_FIELDS = Object.freeze(['actorUuid']);
const ABILITY_LABEL_KEYS = Object.freeze({
  str: 'SWORDS_WIZARDRY.Ability.Str.long',
  dex: 'SWORDS_WIZARDRY.Ability.Dex.long',
  con: 'SWORDS_WIZARDRY.Ability.Con.long',
  int: 'SWORDS_WIZARDRY.Ability.Int.long',
  wis: 'SWORDS_WIZARDRY.Ability.Wis.long',
  cha: 'SWORDS_WIZARDRY.Ability.Cha.long'
});

export class RollService {
  #deps;

  constructor(dependencies) {
    for (const name of [
      'resolveUuid', 'getCurrentUser', 'getUserById', 'getRollMode',
      'getSpeaker', 'evaluateRoll', 'renderTemplate', 'enrichHTML',
      'createChatMessage'
    ]) {
      if (typeof dependencies?.[name] !== 'function') {
        throw new TypeError(`RollService requires ${name}.`);
      }
    }
    this.#deps = dependencies;
  }

  async save(actor, options = {}) {
    if (!actor?.uuid || actor.isOwner === false) return failure('NOT_AUTHORIZED');
    const target = Number(actor.system?.save?.value);
    if (!Number.isSafeInteger(target)) return failure('INVALID_SAVE_TARGET');
    return this.#rollAndPost({
      actor,
      formula: '1d20',
      rollData: serializableRollData(actor),
      rollMode: options.rollMode ?? this.#deps.getRollMode(),
      template: SAVE_TEMPLATE,
      context: (evaluation) => ({
        total: evaluation.total,
        target,
        success: evaluation.total >= target,
        roll: evaluation.html
      })
    });
  }

  async ability(actor, abilityKey, options = {}) {
    if (!actor?.uuid || actor.isOwner === false) return failure('NOT_AUTHORIZED');
    const labelKey = ABILITY_LABEL_KEYS[abilityKey];
    if (actor.type !== 'character' || !labelKey) return failure('INVALID_ABILITY');
    const target = Number(actor.system?.abilities?.[abilityKey]?.value);
    if (!Number.isSafeInteger(target)) return failure('INVALID_ABILITY_TARGET');
    return this.#rollAndPost({
      actor,
      formula: `1d20 + @abilities.${abilityKey}.mod`,
      rollData: serializableRollData(actor),
      rollMode: options.rollMode ?? this.#deps.getRollMode(),
      template: ABILITY_TEMPLATE,
      context: (evaluation) => ({
        labelKey,
        total: evaluation.total,
        ...evaluateThreshold({
          total: evaluation.total,
          target,
          targetType: 'descending'
        }),
        roll: evaluation.html
      })
    });
  }

  async feature(item, options = {}) {
    if (item?.type !== 'feature' || !item?.uuid) return failure('INVALID_FEATURE');
    const actor = item.actor ?? item.parent ?? null;
    if (!actor?.uuid || item.isOwner === false) return failure('NOT_AUTHORIZED');
    try {
      const formula = normalizeFeatureFormula(item.system?.formula ?? '');
      const rollMode = normalizeRollMode(options.rollMode ?? this.#deps.getRollMode());
      const rollData = serializableRollData(actor);
      const itemContext = {
        name: item.name,
        img: item.img || FEATURE_ICON
      };
      const description = await this.#deps.enrichHTML(item.system?.description ?? '', {
        relativeTo: item,
        rollData
      });
      if (!formula) {
        const content = await this.#deps.renderTemplate(FEATURE_TEMPLATE, {
          item: itemContext,
          description,
          roll: null
        });
        const message = await this.#deps.createChatMessage({
          speaker: this.#deps.getSpeaker({ actor }),
          rollMode,
          content,
          rolls: []
        });
        return { status: 'success', code: null, message };
      }
      return this.#rollAndPost({
        actor,
        formula,
        rollData,
        rollMode,
        template: FEATURE_TEMPLATE,
        context: (evaluation) => ({
          item: itemContext,
          description,
          total: evaluation.total,
          ...evaluateThreshold({
            total: evaluation.total,
            target: item.system?.target,
            targetType: item.system?.targetType
          }),
          roll: evaluation.html
        })
      });
    } catch (error) {
      return rollFailure(error);
    }
  }

  morale(actorOrUuid) {
    if (!this.#deps.authority) return Promise.resolve(failure('AUTHORITY_UNAVAILABLE'));
    const actorUuid = typeof actorOrUuid === 'string' ? actorOrUuid : actorOrUuid?.uuid;
    return this.#deps.authority.request('morale.roll', { actorUuid });
  }

  async handleMorale({ senderUserId, payload }) {
    try {
      if (!this.#isActiveGM()) return failure('NO_ACTIVE_GM');
      assertExactObject(payload, MORALE_FIELDS);
      validateUuid(payload.actorUuid);
      const sender = this.#deps.getUserById(senderUserId);
      const actor = await this.#deps.resolveUuid(payload.actorUuid);
      if (
        !sender
        || actor?.type !== 'npc'
        || actor.testUserPermission?.(sender, 'OWNER') !== true
      ) return failure('NOT_AUTHORIZED');
      const target = Number(actor.system?.morale);
      if (!Number.isSafeInteger(target)) return failure('INVALID_MORALE_TARGET');
      const result = await this.#rollAndPost({
        actor,
        formula: '2d6',
        rollData: serializableRollData(actor),
        rollMode: 'gmroll',
        template: MORALE_TEMPLATE,
        context: (evaluation) => ({
          total: evaluation.total,
          target,
          success: evaluation.total <= target,
          roll: evaluation.html
        })
      });
      return result.status === 'success'
        ? { status: 'success', code: null }
        : result;
    } catch (error) {
      return rollFailure(error);
    }
  }

  async #rollAndPost({ actor, formula, rollData, rollMode, template, context }) {
    try {
      const normalizedMode = normalizeRollMode(rollMode);
      const evaluation = await this.#deps.evaluateRoll(formula, rollData, {
        rollMode: normalizedMode
      });
      if (!Number.isFinite(evaluation?.total)) {
        throw new RollValidationError('INVALID_ROLL_RESULT');
      }
      const content = await this.#deps.renderTemplate(template, context(evaluation));
      const message = await this.#deps.createChatMessage({
        speaker: this.#deps.getSpeaker({ actor }),
        rollMode: normalizedMode,
        content,
        rolls: evaluation.roll ? [evaluation.roll] : []
      });
      return { status: 'success', code: null, message };
    } catch (error) {
      return rollFailure(error);
    }
  }

  #isActiveGM() {
    const user = this.#deps.getCurrentUser();
    return user?.isGM === true && user?.isActiveGM === true;
  }
}

export function createFoundryRollService({ authority }) {
  const renderTemplate = foundry.applications.handlebars.renderTemplate;
  const TextEditor = foundry.applications.ux.TextEditor;
  const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
  return new RollService({
    resolveUuid: (uuid) => resolveUuid(uuid),
    getCurrentUser: () => game.user,
    getUserById: (id) => game.users.get(id),
    getRollMode: () => readFoundryRollMode(game.settings),
    getSpeaker: ({ actor }) => ChatMessage.getSpeaker({ actor }),
    async evaluateRoll(formula, data) {
      if (!Roll.validate(formula)) throw new RollValidationError('INVALID_ROLL_FORMULA');
      const roll = await new Roll(formula, data).evaluate();
      return {
        formula,
        total: roll.total,
        roll,
        html: await roll.render()
      };
    },
    renderTemplate,
    enrichHTML: (html, options) => TextEditor.enrichHTML(html, options),
    createChatMessage: (data) => ChatMessage.create(
      applyFoundryChatVisibility(ChatMessage, data)
    ),
    authority
  });
}

function serializableRollData(actor) {
  const data = actor.getRollData?.() ?? actor.system ?? {};
  if (typeof foundry !== 'undefined' && foundry.utils?.deepClone) {
    return foundry.utils.deepClone(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function assertExactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RollValidationError('INVALID_REQUEST');
  }
  const allowed = new Set(fields);
  if (
    Object.keys(value).some((key) => !allowed.has(key))
    || fields.some((field) => !Object.hasOwn(value, field))
  ) throw new RollValidationError('INVALID_REQUEST');
}

function rollFailure(error) {
  const known = error instanceof RollValidationError
    ? error.code
    : error?.message === 'invalid formula'
      ? 'INVALID_ROLL_FORMULA'
      : 'ROLL_FAILED';
  return failure(known);
}

function failure(code) {
  return { status: 'failure', code };
}

export { applyFoundryChatVisibility };
