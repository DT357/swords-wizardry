import { createFoundryImportService } from './service.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYSTEM_ID = 'swords-wizardry';

export class ImportManager {
  static showImportFromStatblock() {
    if (!game.user?.isGM) return;
    void new ImportSheet({ importService: createFoundryImportService() }).render(true);
  }

  static addImportActorButton(_app, html) {
    if (!game.user?.isGM) return;
    const root = html?.querySelector ? html : html?.[0];
    const actions = root?.querySelector?.('.header-actions');
    if (!actions || actions.querySelector('.import-manager')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'import-manager';
    button.dataset.tooltip = game.i18n.localize('SWORDS_WIZARDRY.Importer.OpenHint');
    button.innerHTML = `<i class="fas fa-user-plus" aria-hidden="true"></i><span>${
      game.i18n.localize('SWORDS_WIZARDRY.Importer.Open')
    }</span>`;
    button.addEventListener('click', () => this.showImportFromStatblock());
    actions.append(button);
  }
}

export class ImportSheet extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ importService = createFoundryImportService(), ...options } = {}) {
    super(options);
    this.importService = importService;
    this.importText = '';
    this.errors = [];
    this.pending = false;
  }

  static DEFAULT_OPTIONS = {
    id: 'swords-wizardry-import-sheet',
    form: {
      handler: ImportSheet.onSubmit,
      closeOnSubmit: false
    },
    position: { height: 400, width: 500 },
    tag: 'form',
    window: {
      icon: 'fas fa-file-import',
      contentClasses: ['swords-wizardry', 'swords-wizardry-importer']
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM_ID}/module/importer/importer.hbs` }
  };

  get title() {
    return game.i18n.localize('SWORDS_WIZARDRY.Importer.Title');
  }

  _prepareContext() {
    return {
      importText: this.importText,
      errors: this.errors.map((error) => ({
        ...error,
        message: game.i18n.format('SWORDS_WIZARDRY.Importer.FieldError', {
          field: game.i18n.localize(`SWORDS_WIZARDRY.Importer.Fields.${error.field}`),
          error: game.i18n.localize(`SWORDS_WIZARDRY.Importer.Errors.${error.code}`)
        })
      })),
      pending: this.pending
    };
  }

  static async onSubmit(_event, form, formData) {
    if (this.pending || !game.user?.isGM) {
      if (!game.user?.isGM) {
        ui.notifications?.error?.(
          game.i18n.localize('SWORDS_WIZARDRY.Importer.NotAuthorized')
        );
      }
      return;
    }
    this.importText = String(formData.get('importText') ?? '');
    const submit = form?.querySelector?.('button[type="submit"]');
    this.pending = true;
    if (submit) submit.disabled = true;
    try {
      const result = await this.importService.import(this.importText);
      if (result.status === 'success') {
        await this.close();
        return;
      }
      this.errors = result.errors ?? [{ field: 'form', code: result.code }];
      ui.notifications?.error?.(
        game.i18n.localize(`SWORDS_WIZARDRY.Importer.Errors.${result.code}`)
      );
      await this.render(false, { focus: false });
    } finally {
      this.pending = false;
      if (submit?.isConnected) submit.disabled = false;
    }
  }
}
