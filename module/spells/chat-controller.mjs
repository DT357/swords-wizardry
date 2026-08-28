import { SPELL_FLAG_KEY, SYSTEM_ID } from './constants.mjs';
import { isApplicationEntryForMessage } from './application.mjs';

export class SpellChatController {
  #deps;
  #hookId = null;
  #renderHandler;

  constructor(dependencies) {
    this.#deps = dependencies;
    this.#renderHandler = (message, html) => this.#onRender(message, html);
  }

  start() {
    if (this.#hookId != null) return;
    this.#hookId = this.#deps.hooks.on('renderChatMessageHTML', this.#renderHandler);
  }

  stop() {
    if (this.#hookId == null) return;
    this.#deps.hooks.off('renderChatMessageHTML', this.#hookId);
    this.#hookId = null;
  }

  #onRender(message, html) {
    const spell = message.getFlag?.(SYSTEM_ID, SPELL_FLAG_KEY)
      ?? message.flags?.[SYSTEM_ID]?.[SPELL_FLAG_KEY];
    if (!spell) return;
    const root = html.matches?.('[data-spell-message-kind]')
      ? html
      : html.querySelector?.('[data-spell-message-kind]') ?? html;
    if (!root?.dataset) return;

    this.#decorate(message, root, spell);
    if (root.dataset.spellControllerBound === 'true') return;
    root.dataset.spellControllerBound = 'true';
    root.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button[data-action]');
      if (!button || (root.contains && !root.contains(button))) return;
      if (button.dataset.action === 'spellAction') {
        await this.#runButton(button, () => this.#deps.spellService.invoke(
          message,
          button.dataset.spellActionId
        ));
      }
      if (button.dataset.action === 'spellApply') {
        await this.#runButton(button, () => this.#deps.applicationService.apply(message, {
          targetUuid: button.dataset.targetUuid,
          kind: button.dataset.kind,
          multiplier: Number(button.dataset.multiplier)
        }));
      }
    });
  }

  async #runButton(button, operation) {
    button.disabled = true;
    try {
      const result = await operation();
      if (result?.status === 'success' || result?.status === 'duplicate') return;
      const key = `SWORDS_WIZARDRY.Spell.Validation.${result?.code ?? 'UNKNOWN'}`;
      const localized = this.#deps.localize(key);
      this.#deps.notify(
        result?.status === 'unsafe' ? 'error' : 'warn',
        localized === key
          ? this.#deps.localize('SWORDS_WIZARDRY.Spell.Validation.UNKNOWN')
          : localized
      );
    } finally {
      button.disabled = false;
    }
  }

  #decorate(message, root, spell) {
    const isGM = this.#deps.getCurrentUser()?.isGM === true;
    if (!isGM) {
      for (const controls of root.querySelectorAll?.('.spell-result__application-controls') ?? []) {
        controls.remove();
      }
    }

    for (const [applicationId, entry] of Object.entries(spell.application?.entries ?? {})) {
      if (!isApplicationEntryForMessage(applicationId, entry, message.uuid)) continue;
      const target = Array.from(
        root.querySelectorAll?.('[data-spell-target-uuid]') ?? []
      ).find((element) => element.dataset.spellTargetUuid === entry.targetUuid);
      if (!target) continue;
      for (const controls of target.querySelectorAll('.spell-result__application-controls')) {
        controls.remove();
      }
      const status = target.querySelector('.spell-result__application-status');
      if (status) {
        status.textContent = this.#deps.localize('SWORDS_WIZARDRY.Spell.Card.Applied', {
          amount: entry.appliedAmount
        });
      }
    }

    if (spell.consumption?.status === 'failed' && !root.querySelector?.('.spell-card__warning')) {
      const warning = document.createElement('p');
      warning.className = 'spell-card__warning';
      warning.setAttribute('role', 'alert');
      warning.textContent = this.#deps.localize('SWORDS_WIZARDRY.Spell.Card.ConsumptionFailed');
      root.append(warning);
    }
  }
}

export function createFoundrySpellChatController(spellService, applicationService) {
  return new SpellChatController({
    hooks: Hooks,
    spellService,
    applicationService,
    getCurrentUser: () => game.user,
    localize: (key, data = {}) => game.i18n.format(key, data),
    notify: (level, message) => ui.notifications?.[level]?.(message)
  });
}
