import { validateUuid } from '../authority/domain.mjs';
import { evaluateAttackPlan } from '../spells/attack-plan.mjs';
import {
  applyFoundryChatVisibility,
  readFoundryRollMode
} from '../rolls/chat-visibility.mjs';
import {
  WEAPON_MESSAGE_SCHEMA_VERSION,
  WeaponValidationError,
  buildWeaponPlan,
  fingerprintWeaponPlan
} from './domain.mjs';

const SYSTEM_ID = 'swords-wizardry';
const ATTACK_TEMPLATE = `systems/${SYSTEM_ID}/module/templates/weapons/attack-result.hbs`;
const DAMAGE_TEMPLATE = `systems/${SYSTEM_ID}/module/templates/weapons/damage-result.hbs`;
const ATTACK_FIELDS = Object.freeze(['itemUuid', 'targetUuids', 'rollMode']);
const DAMAGE_FIELDS = Object.freeze(['attackMessageUuid']);
const ROLL_MODES = Object.freeze([
  'publicroll', 'gmroll', 'blindroll', 'selfroll',
  'public', 'gm', 'blind', 'self', 'roll'
]);

export class WeaponService {
  #deps;

  constructor(dependencies) {
    const required = [
      'resolveUuid', 'getCurrentUser', 'getUserById', 'getSpeaker',
      'useAscendingAC', 'dmAppliesDamage', 'evaluateRoll',
      'renderTemplate', 'createChatMessage'
    ];
    for (const dependency of required) {
      if (typeof dependencies?.[dependency] !== 'function') {
        throw new TypeError(`WeaponService requires ${dependency}.`);
      }
    }
    this.#deps = dependencies;
  }

  attack(itemOrUuid, options = {}) {
    if (!this.#deps.authority) return failure('AUTHORITY_UNAVAILABLE');
    const itemUuid = typeof itemOrUuid === 'string' ? itemOrUuid : itemOrUuid?.uuid;
    return this.#deps.authority.request('weapon.attack', {
      itemUuid,
      targetUuids: options.targetUuids ?? this.#deps.getSelectedTargetUuids?.() ?? [],
      rollMode: options.rollMode ?? this.#deps.getRollMode?.() ?? 'publicroll'
    });
  }

  damage(attackMessageOrUuid) {
    if (!this.#deps.authority) return failure('AUTHORITY_UNAVAILABLE');
    return this.#deps.authority.request('weapon.damage', {
      attackMessageUuid: typeof attackMessageOrUuid === 'string'
        ? attackMessageOrUuid
        : attackMessageOrUuid?.uuid
    });
  }

  async handleAttack({ senderUserId, payload }) {
    try {
      if (!this.#isActiveGM()) return failure('NO_ACTIVE_GM');
      assertExactObject(payload, ATTACK_FIELDS);
      validateUuid(payload.itemUuid);
      const targetUuids = validateTargetUuids(payload.targetUuids);
      if (!ROLL_MODES.includes(payload.rollMode)) return failure('INVALID_REQUEST');
      const sender = this.#deps.getUserById(senderUserId);
      if (!sender) return failure('NOT_AUTHORIZED');
      const item = await this.#deps.resolveUuid(payload.itemUuid);
      const actor = item?.actor ?? item?.parent ?? null;
      if (
        item?.type !== 'weapon'
        || !actor?.uuid
        || item.testUserPermission?.(sender, 'OWNER') !== true
      ) return failure('NOT_AUTHORIZED');

      const plan = buildWeaponPlan({
        item,
        actor,
        useAscendingAC: this.#deps.useAscendingAC()
      });
      const evaluation = await this.#deps.evaluateRoll(plan.attackFormula, {}, {
        rollMode: payload.rollMode
      });
      if (!Number.isFinite(evaluation?.total)) return failure('ROLL_FAILED');
      const targets = await this.#resolveTargets(targetUuids);
      const outcomes = evaluateAttackPlan({
        total: evaluation.total,
        mode: plan.attackMode,
        useAscendingAC: plan.useAscendingAC,
        attacker: plan.attacker,
        targets
      });
      const renderedTargets = targets.map((target) => ({
        ...target,
        outcome: outcomes.find((entry) => entry.uuid === target.uuid)?.outcome ?? 'missing'
      }));
      const hitTargetUuids = outcomes
        .filter((entry) => entry.outcome === 'hit')
        .map((entry) => entry.uuid);
      const flags = {
        schemaVersion: WEAPON_MESSAGE_SCHEMA_VERSION,
        messageKind: 'weapon-attack',
        requestedBy: senderUserId,
        sourceActorUuid: actor.uuid,
        sourceItemUuid: item.uuid,
        sourceFingerprint: fingerprintWeaponPlan(plan),
        item: { name: item.name, img: item.img ?? '', specialDamage: plan.specialDamage },
        attack: {
          formula: evaluation.formula ?? plan.attackFormula,
          total: evaluation.total,
          mode: plan.attackMode,
          outcomes
        },
        damageFormula: plan.damageFormula,
        targetUuids,
        hitTargetUuids,
        targets: renderedTargets,
        rollMode: payload.rollMode
      };
      const content = await this.#deps.renderTemplate(ATTACK_TEMPLATE, {
        weapon: flags,
        rollHTML: evaluation.html ?? ''
      });
      const message = await this.#deps.createChatMessage({
        speaker: this.#deps.getSpeaker({ actor }),
        rollMode: payload.rollMode,
        content,
        rolls: evaluation.roll ? [evaluation.roll] : [],
        flags: { [SYSTEM_ID]: { weapon: flags } }
      });
      return { status: 'success', code: null, messageUuid: message.uuid };
    } catch (error) {
      return toFailure(error, 'ATTACK_FAILED');
    }
  }

  async handleDamage({ senderUserId, payload }) {
    try {
      if (!this.#isActiveGM()) return failure('NO_ACTIVE_GM');
      assertExactObject(payload, DAMAGE_FIELDS);
      validateUuid(payload.attackMessageUuid);
      const sender = this.#deps.getUserById(senderUserId);
      if (!sender) return failure('NOT_AUTHORIZED');
      const attackMessage = await this.#deps.resolveUuid(payload.attackMessageUuid);
      const flags = attackMessage?.flags?.[SYSTEM_ID]?.weapon;
      const authorId = attackMessage?.author?.id
        ?? attackMessage?.user?.id
        ?? attackMessage?.user;
      const author = this.#deps.getUserById(authorId);
      if (
        !author?.isGM
        || flags?.schemaVersion !== WEAPON_MESSAGE_SCHEMA_VERSION
        || flags?.messageKind !== 'weapon-attack'
        || (!sender.isGM && flags.requestedBy !== senderUserId)
      ) return failure('INVALID_ATTACK_CAPABILITY');
      if (!Array.isArray(flags.hitTargetUuids) || flags.hitTargetUuids.length === 0) {
        return failure('NO_HIT_TARGETS');
      }
      const evaluation = await this.#deps.evaluateRoll(flags.damageFormula, {}, {
        rollMode: flags.rollMode
      });
      if (!Number.isFinite(evaluation?.total) || evaluation.total < 0) {
        return failure('ROLL_FAILED');
      }
      const targets = await this.#resolveTargets(flags.hitTargetUuids);
      const damageFlags = {
        schemaVersion: WEAPON_MESSAGE_SCHEMA_VERSION,
        messageKind: 'weapon-damage',
        requestedBy: flags.requestedBy,
        sourceAttackMessageUuid: attackMessage.uuid,
        sourceActorUuid: flags.sourceActorUuid,
        sourceItemUuid: flags.sourceItemUuid,
        actionId: 'weapon-damage',
        actionFingerprint: flags.sourceFingerprint,
        item: structuredCopy(flags.item),
        targetUuids: [...flags.hitTargetUuids],
        targets,
        result: {
          formula: evaluation.formula ?? flags.damageFormula,
          total: evaluation.total
        }
      };
      const content = await this.#deps.renderTemplate(DAMAGE_TEMPLATE, {
        weapon: damageFlags,
        rollHTML: evaluation.html ?? ''
      });
      const message = await this.#deps.createChatMessage({
        speaker: this.#deps.getSpeaker({ actor: await this.#deps.resolveUuid(flags.sourceActorUuid) }),
        rollMode: flags.rollMode,
        content,
        rolls: evaluation.roll ? [evaluation.roll] : [],
        flags: {
          [SYSTEM_ID]: {
            weapon: damageFlags,
            hitPoints: { schemaVersion: 1, entries: {} }
          }
        }
      });
      if (this.#deps.hitPointService && this.#deps.dmAppliesDamage() === false) {
        for (const targetUuid of damageFlags.targetUuids) {
          await this.#deps.hitPointService.applyAuthorized({
            messageUuid: message.uuid,
            targetUuid,
            mode: 'fullDamage',
            requestedBy: flags.requestedBy
          });
        }
      }
      return { status: 'success', code: null, messageUuid: message.uuid };
    } catch (error) {
      return toFailure(error, 'DAMAGE_FAILED');
    }
  }

  async #resolveTargets(targetUuids) {
    const targets = [];
    for (const uuid of targetUuids) {
      const document = await this.#deps.resolveUuid(uuid);
      const actor = document?.actor
        ?? (document?.documentName === 'Actor' || document?.uuid?.startsWith('Actor.')
          ? document : null);
      targets.push({
        uuid,
        actorUuid: actor?.uuid ?? null,
        name: document?.name ?? actor?.name ?? uuid,
        status: actor ? 'resolved' : 'missing',
        ac: actor?.system?.ac?.value ?? null,
        aac: actor?.system?.aac?.value ?? null
      });
    }
    return targets;
  }

  #isActiveGM() {
    const user = this.#deps.getCurrentUser();
    return user?.isGM === true && user?.isActiveGM === true;
  }
}

export function createFoundryWeaponService({ authority, hitPointService }) {
  const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
  const renderTemplate = foundry.applications.handlebars.renderTemplate;
  return new WeaponService({
    resolveUuid: (uuid) => resolveUuid(uuid),
    getCurrentUser: () => game.user,
    getUserById: (id) => game.users.get(id),
    getSpeaker: ({ actor }) => ChatMessage.getSpeaker({ actor }),
    useAscendingAC: () => game.settings.get(SYSTEM_ID, 'useAscendingAC'),
    dmAppliesDamage: () => game.settings.get(SYSTEM_ID, 'dmAppliesDamage'),
    getSelectedTargetUuids: () => Array.from(game.user?.targets ?? [])
      .map((target) => target.document?.uuid ?? target.uuid)
      .filter(Boolean),
    getRollMode: () => readFoundryRollMode(game.settings),
    async evaluateRoll(formula) {
      if (!Roll.validate(formula)) throw new WeaponValidationError('INVALID_ROLL_FORMULA');
      const roll = await new Roll(formula).evaluate();
      return {
        formula,
        total: roll.total,
        roll,
        html: await roll.render()
      };
    },
    renderTemplate,
    createChatMessage: (data) => ChatMessage.create(
      applyFoundryChatVisibility(ChatMessage, data)
    ),
    authority,
    hitPointService
  });
}

function validateTargetUuids(value) {
  if (!Array.isArray(value) || value.length > 100) throw new WeaponValidationError('INVALID_REQUEST');
  const targetUuids = [...new Set(value)];
  for (const uuid of targetUuids) validateUuid(uuid);
  return targetUuids;
}

function assertExactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WeaponValidationError('INVALID_REQUEST');
  }
  const allowed = new Set(fields);
  if (
    Object.keys(value).some((key) => !allowed.has(key))
    || fields.some((field) => !Object.hasOwn(value, field))
  ) throw new WeaponValidationError('INVALID_REQUEST');
}

function toFailure(error, fallback) {
  return failure(error instanceof WeaponValidationError ? error.code : fallback);
}

function failure(code) {
  return { status: 'failure', code };
}

function structuredCopy(value) {
  return JSON.parse(JSON.stringify(value));
}
