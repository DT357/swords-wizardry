import { applyFoundryChatVisibility } from '../rolls/chat-visibility.mjs';
import { reportError } from '../helpers/logger.mjs';
import { planSideInitiativeUpdates } from './side-initiative.mjs';

const { CombatTracker } = foundry.applications.sidebar.tabs;
const SYSTEM_ID = 'swords-wizardry';
const SIDE_INITIATIVE_TEMPLATE = `systems/${SYSTEM_ID}/module/templates/combat/side-initiative.hbs`;
export const SIDE_INITIATIVE_OPTION = 'swordsWizardrySideInitiative';

export class SwordsWizardryCombatTracker extends CombatTracker {
  async getData(options) {
    const data = await super.getData(options);
    data.game = game;
    return data;
  }

  async _onRender(context, options) {
    let safeOptions = options;
    if (
      Array.isArray(options?.renderData)
      && !options.renderData.some((data) => data?._id === this.viewed?.id)
    ) {
      safeOptions = { ...options, renderData: null };
    }
    return super._onRender(context, safeOptions);
  }
}

export class SwordsWizardryCombat extends Combat {
  #sideInitiativeTask = null;

  _onUpdate(changed, options, userId) {
    const result = super._onUpdate(changed, options, userId);
    this.#refreshCombatantSheets();
    if (
      foundry.utils.hasProperty(changed, 'round')
      && options?.[SIDE_INITIATIVE_OPTION] !== true
      && isActiveGM()
    ) {
      void this.rollSideInitiative().catch((error) => this.#reportInitiativeError(error));
    }
    if (foundry.utils.hasProperty(changed, 'turn')) this.#focusCurrentTurn();
    return result;
  }

  _onCreate(data, options, userId) {
    const result = super._onCreate(data, options, userId);
    this.#refreshCombatantSheets();
    return result;
  }

  _onDelete(options, userId) {
    const result = super._onDelete(options, userId);
    this.#refreshCombatantSheets();
    return result;
  }

  rollAll(_options = {}) {
    return this.rollSideInitiative();
  }

  rollSideInitiative() {
    if (!isActiveGM()) {
      return Promise.resolve({ status: 'failure', code: 'NO_ACTIVE_GM' });
    }
    if (this.#sideInitiativeTask) return this.#sideInitiativeTask;
    this.#sideInitiativeTask = this.#executeSideInitiative()
      .finally(() => { this.#sideInitiativeTask = null; });
    return this.#sideInitiativeTask;
  }

  async #executeSideInitiative() {
    const partyRoll = await new Roll('1d6').evaluate();
    const opponentRoll = await new Roll('1d6').evaluate();
    if (!isActiveGM()) return { status: 'failure', code: 'NO_ACTIVE_GM' };

    const updates = planSideInitiativeUpdates(this.combatants, {
      partyTotal: partyRoll.total,
      opponentTotal: opponentRoll.total
    });
    if (updates.length) {
      await this.updateEmbeddedDocuments('Combatant', updates);
    }
    await this.update(
      { turn: 0 },
      { [SIDE_INITIATIVE_OPTION]: true }
    );

    const render = foundry.applications.handlebars?.renderTemplate
      ?? globalThis.renderTemplate;
    const content = await render(SIDE_INITIATIVE_TEMPLATE, {
      partyRollHTML: await partyRoll.render(),
      opponentRollHTML: await opponentRoll.render()
    });
    const message = await ChatMessage.create(applyFoundryChatVisibility(ChatMessage, {
      speaker: ChatMessage.getSpeaker(),
      rollMode: 'publicroll',
      content,
      rolls: [partyRoll, opponentRoll]
    }));
    return { status: 'success', code: null, message };
  }

  #refreshCombatantSheets() {
    for (const combatant of this.combatants ?? []) {
      const actor = combatant?.actor;
      if (actor?.isOwner && actor.sheet?.rendered) actor.sheet.render();
    }
  }

  #focusCurrentTurn() {
    const token = this.combatant?.token;
    const currentCanvas = globalThis.canvas;
    if (
      !token?.isOwner
      || !currentCanvas?.ready
      || token.parent?.id !== currentCanvas.scene?.id
      || !token.object
    ) return;
    token.object.control({ releaseOthers: true });
    void currentCanvas.animatePan({
      x: token.x,
      y: token.y,
      scale: Math.max(1, Number(currentCanvas.stage?.scale?.x) || 1),
      duration: 1000
    });
  }

  #reportInitiativeError(error) {
    reportError('Side initiative failed.', error);
    ui.notifications?.error?.(
      game.i18n.localize('SWORDS_WIZARDRY.Combat.SideInitiativeFailed')
    );
  }
}

function isActiveGM() {
  return game.user?.isGM === true && game.user?.isActiveGM === true;
}
