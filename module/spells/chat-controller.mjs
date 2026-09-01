import { createApplicationId } from '../hit-points/domain.mjs';
import {
  SPELL_FLAG_KEY,
  SPELL_MESSAGE_SCHEMA_VERSION,
  SYSTEM_ID
} from './constants.mjs';

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

    const currentSchema = spell.schemaVersion === SPELL_MESSAGE_SCHEMA_VERSION;
    const trustedResult = this.#isTrustedResult(message, spell);
    this.#decorate(message, root, spell, currentSchema, trustedResult);
    const interactive = currentSchema && (
      spell.messageKind === 'spell-card' || trustedResult
    );
    if (!interactive || root.dataset.spellControllerBound === 'true') return;

    root.dataset.spellControllerBound = 'true';
    root.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button[data-action]');
      if (!button || (root.contains && !root.contains(button))) return;
      if (
        spell.messageKind === 'spell-card'
        && button.dataset.action === 'spellAction'
      ) {
        await this.#runButton(button, () => this.#deps.spellService.invoke(
          message,
          button.dataset.spellActionId
        ));
      }
      if (
        trustedResult
        && button.dataset.action === 'spellApply'
      ) {
        await this.#runButton(button, () => this.#deps.authority.request(
          'hitPoints.apply',
          {
            messageUuid: message.uuid,
            targetUuid: button.dataset.targetUuid,
            mode: button.dataset.mode
          }
        ));
      }
    });
  }

  #isTrustedResult(message, spell) {
    if (
      spell.schemaVersion !== SPELL_MESSAGE_SCHEMA_VERSION
      || spell.messageKind !== 'spell-result'
    ) return false;
    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    return this.#deps.getUserById(authorId)?.isGM === true;
  }

  #decorate(message, root, spell, currentSchema, trustedResult) {
    const isGM = this.#deps.getCurrentUser()?.isGM === true;
    const manual = this.#deps.dmAppliesDamage() === true;
    if (!trustedResult || !isGM || !manual) {
      for (const controls of root.querySelectorAll?.(
        '.spell-result__application-controls'
      ) ?? []) {
        controls.remove();
      }
    }

    if (!currentSchema || (spell.messageKind === 'spell-result' && !trustedResult)) {
      this.#appendLegacyNotice(root, 'spell-card__legacy-warning');
    }

    const entries = message.flags?.[SYSTEM_ID]?.hitPoints?.entries ?? {};
    for (const target of root.querySelectorAll?.('[data-spell-target-uuid]') ?? []) {
      const targetUuid = target.dataset.spellTargetUuid;
      const applicationId = createApplicationId({
        messageUuid: message.uuid,
        targetUuid
      });
      const entry = entries[applicationId];
      if (!entry || !['applied', 'pending', 'conflict'].includes(entry.status)) continue;
      for (const controls of target.querySelectorAll(
        '.spell-result__application-controls'
      )) {
        controls.remove();
      }
      const status = target.querySelector('.spell-result__application-status');
      if (status) {
        status.textContent = this.#deps.localize(
          entry.status === 'applied'
            ? 'SWORDS_WIZARDRY.Spell.Card.Applied'
            : `SWORDS_WIZARDRY.Authority.Status.${entry.status}`,
          { amount: entry.change?.appliedAmount ?? 0 }
        );
      }
    }

    if (
      spell.consumption?.status === 'failed'
      && !root.querySelector?.('.spell-card__warning')
    ) {
      const warning = document.createElement('p');
      warning.className = 'spell-card__warning';
      warning.setAttribute('role', 'alert');
      warning.textContent = this.#deps.localize(
        'SWORDS_WIZARDRY.Spell.Card.ConsumptionFailed'
      );
      root.append(warning);
    }
  }

  #appendLegacyNotice(root, className) {
    if (root.querySelector?.(`.${className}`)) return;
    const ownerDocument = root.ownerDocument ?? globalThis.document;
    if (!ownerDocument?.createElement || typeof root.append !== 'function') return;
    const warning = ownerDocument.createElement('p');
    warning.className = className;
    warning.setAttribute('role', 'note');
    warning.textContent = this.#deps.localize('SWORDS_WIZARDRY.Authority.LegacyCard');
    root.append(warning);
  }

  async #runButton(button, operation) {
    button.disabled = true;
    try {
      const result = await operation();
      if (['success', 'duplicate'].includes(result?.status)) return;
      const spellKey = `SWORDS_WIZARDRY.Spell.Validation.${result?.code ?? 'UNKNOWN'}`;
      const authorityKey = `SWORDS_WIZARDRY.Authority.Error.${result?.code ?? 'UNKNOWN'}`;
      const localizedSpell = this.#deps.localize(spellKey);
      const message = localizedSpell === spellKey
        ? this.#deps.localize(authorityKey)
        : localizedSpell;
      this.#deps.notify(result?.status === 'unsafe' ? 'error' : 'warn', message);
    } finally {
      button.disabled = false;
    }
  }
}

export function createFoundrySpellChatController({ spellService, authority }) {
  return new SpellChatController({
    hooks: Hooks,
    spellService,
    authority,
    getCurrentUser: () => game.user,
    getUserById: (id) => game.users.get(id),
    dmAppliesDamage: () => game.settings.get(SYSTEM_ID, 'dmAppliesDamage'),
    localize: (key, data = {}) => game.i18n.format(key, data),
    notify: (level, message) => ui.notifications?.[level]?.(message)
  });
}
