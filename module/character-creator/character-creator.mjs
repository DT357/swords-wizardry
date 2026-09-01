import { createFoundryCharacterCreationService } from './service.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYSTEM_ID = 'swords-wizardry';

export class CharacterCreatorManager {
  static showCharacterCreator() {
    if (!game.user?.can?.('ACTOR_CREATE')) return;
    void new CharacterCreator({
      creationService: createFoundryCharacterCreationService()
    }).render(true);
  }

  static addCharacterCreationButton(_app, html) {
    if (!game.user?.can?.('ACTOR_CREATE')) return;
    const root = html?.querySelector ? html : html?.[0];
    const actions = root?.querySelector?.('.header-actions');
    if (!actions || actions.querySelector('.character-creator')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'character-creator';
    button.dataset.tooltip = game.i18n.localize('SWORDS_WIZARDRY.CharacterCreator.OpenHint');
    button.innerHTML = `<i class="fas fa-user-plus" aria-hidden="true"></i><span>${
      game.i18n.localize('SWORDS_WIZARDRY.CharacterCreator.Open')
    }</span>`;
    button.addEventListener('click', () => this.showCharacterCreator());
    actions.append(button);
  }
}

export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ creationService = createFoundryCharacterCreationService(), ...options } = {}) {
    super(options);
    this.creationService = creationService;
    this.pending = false;
    this.nameDraft = '';
    this.folderDraft = '';
    this.error = '';
  }

  static DEFAULT_OPTIONS = {
    id: 'swords-wizardry-character-creator',
    form: {
      handler: CharacterCreator.onSubmit,
      closeOnSubmit: false
    },
    tag: 'form',
    window: {
      icon: 'fas fa-user-plus',
      contentClasses: ['swords-wizardry', 'swords-wizardry-character-creator']
    }
  };

  static PARTS = {
    main: {
      template: `systems/${SYSTEM_ID}/module/character-creator/character-creator.hbs`
    }
  };

  get title() {
    return game.i18n.localize('SWORDS_WIZARDRY.CharacterCreator.Title');
  }

  _prepareContext() {
    return {
      folders: game.folders.filter((folder) => (
        folder.type === 'Actor' && folder.visible !== false
      )),
      nameDraft: this.nameDraft,
      folderDraft: this.folderDraft,
      pending: this.pending,
      error: this.error
    };
  }

  static async onSubmit(_event, form, formData) {
    if (this.pending) return;
    if (!game.user?.can?.('ACTOR_CREATE')) {
      ui.notifications?.error?.(
        game.i18n.localize('SWORDS_WIZARDRY.CharacterCreator.Errors.NOT_AUTHORIZED')
      );
      return;
    }
    this.nameDraft = String(formData.get('name') ?? '');
    this.folderDraft = String(formData.get('folder') ?? '');
    const submit = form?.querySelector?.('button[type="submit"]');
    this.pending = true;
    if (submit) submit.disabled = true;
    try {
      const result = await this.creationService.create({
        name: this.nameDraft,
        folderId: this.folderDraft || null
      });
      if (result.status === 'success') {
        await this.close();
        return;
      }
      this.error = game.i18n.localize(
        `SWORDS_WIZARDRY.CharacterCreator.Errors.${result.code}`
      );
      ui.notifications?.error?.(this.error);
      await this.render(false, { focus: false });
    } finally {
      this.pending = false;
      if (submit?.isConnected) submit.disabled = false;
    }
  }
}
