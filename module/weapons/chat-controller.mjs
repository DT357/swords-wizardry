import { createApplicationId } from '../hit-points/domain.mjs';
import { WEAPON_MESSAGE_SCHEMA_VERSION } from './domain.mjs';

const SYSTEM_ID = 'swords-wizardry';

export class WeaponChatController {
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
    const flags = message.flags?.[SYSTEM_ID]?.weapon;
    if (!flags) {
      this.#disableLegacyControls(html);
      return;
    }
    const root = html.matches?.('[data-weapon-message-kind]')
      ? html
      : html.querySelector?.('[data-weapon-message-kind]') ?? html;
    if (!root?.dataset) return;

    const authorId = message.author?.id ?? message.user?.id ?? message.user;
    const trusted = this.#deps.getUserById(authorId)?.isGM === true
      && flags.schemaVersion === WEAPON_MESSAGE_SCHEMA_VERSION;
    this.#decorate(message, root, flags, trusted);
    if (!trusted || root.dataset.weaponControllerBound === 'true') return;
    root.dataset.weaponControllerBound = 'true';
    root.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('button[data-action]');
      if (!button || (root.contains && !root.contains(button))) return;
      if (button.dataset.action === 'weaponDamage') {
        await this.#run(button, () => this.#deps.weaponService.damage(message));
      }
      if (button.dataset.action === 'weaponApply') {
        await this.#run(button, () => this.#deps.authority.request('hitPoints.apply', {
          messageUuid: message.uuid,
          targetUuid: button.dataset.targetUuid,
          mode: button.dataset.mode
        }));
      }
    });
  }

  #decorate(message, root, flags, trusted) {
    const isGM = this.#deps.getCurrentUser()?.isGM === true;
    const manual = this.#deps.dmAppliesDamage() === true;
    if (!trusted || !isGM || !manual) {
      for (const controls of root.querySelectorAll?.('.weapon-card__application-controls') ?? []) {
        controls.remove();
      }
    }

    if (!trusted) this.#appendLegacyNotice(root);

    const entries = message.flags?.[SYSTEM_ID]?.hitPoints?.entries ?? {};
    for (const target of root.querySelectorAll?.('[data-weapon-target-uuid]') ?? []) {
      const targetUuid = target.dataset.weaponTargetUuid;
      const applicationId = createApplicationId({
        messageUuid: message.uuid,
        targetUuid
      });
      const entry = entries[applicationId];
      if (!entry || !['applied', 'pending', 'conflict'].includes(entry.status)) continue;
      for (const controls of target.querySelectorAll('.weapon-card__application-controls')) {
        controls.remove();
      }
      const status = target.querySelector('.weapon-card__application-status');
      if (status) {
        status.textContent = this.#deps.localize(
          entry.status === 'applied'
            ? 'SWORDS_WIZARDRY.Spell.Card.Applied'
            : `SWORDS_WIZARDRY.Authority.Status.${entry.status}`,
          { amount: entry.change?.appliedAmount ?? 0 }
        );
      }
    }
  }

  #disableLegacyControls(html) {
    const controls = html.querySelectorAll?.(
      '.damage-roll-button, .apply-damage:not([data-action="spellApply"])'
    ) ?? [];
    for (const control of controls) {
      control.disabled = true;
      control.title = this.#deps.localize('SWORDS_WIZARDRY.Authority.LegacyCard');
    }
    if (controls.length) this.#appendLegacyNotice(html);
  }

  #appendLegacyNotice(root) {
    if (root.querySelector?.('.weapon-card__legacy-warning')) return;
    const ownerDocument = root.ownerDocument ?? globalThis.document;
    if (!ownerDocument?.createElement || typeof root.append !== 'function') return;
    const warning = ownerDocument.createElement('p');
    warning.className = 'weapon-card__legacy-warning';
    warning.setAttribute('role', 'note');
    warning.textContent = this.#deps.localize('SWORDS_WIZARDRY.Authority.LegacyCard');
    root.append(warning);
  }

  async #run(button, operation) {
    button.disabled = true;
    try {
      const result = await operation();
      if (['success', 'duplicate'].includes(result?.status)) return;
      this.#deps.notify('warn', this.#deps.localize(
        `SWORDS_WIZARDRY.Authority.Error.${result?.code ?? 'UNKNOWN'}`
      ));
    } finally {
      button.disabled = false;
    }
  }
}

export function createFoundryWeaponChatController({ weaponService, authority }) {
  return new WeaponChatController({
    hooks: Hooks,
    weaponService,
    authority,
    getCurrentUser: () => game.user,
    getUserById: (id) => game.users.get(id),
    dmAppliesDamage: () => game.settings.get(SYSTEM_ID, 'dmAppliesDamage'),
    localize: (key, data = {}) => game.i18n.format(key, data),
    notify: (level, message) => ui.notifications?.[level]?.(message)
  });
}
