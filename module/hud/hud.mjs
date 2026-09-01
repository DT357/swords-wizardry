const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const SYSTEM_ID = 'swords-wizardry';
const HUD_LEFT = 15;
const HUD_MIN_WIDTH = 200;
const HUD_MAX_WIDTH = 350;
const HUDS = new Map();
const MANAGER_HOOKS = new Map();
let reconcileRequested = false;
let reconcileTask = null;
const MANAGER_EVENTS = Object.freeze([
  'controlToken',
  'deleteToken',
  'canvasTearDown',
  'canvasReady',
  'updateActor',
  'createItem',
  'updateItem',
  'deleteItem'
]);

export class CombatHud extends HandlebarsApplicationMixin(ApplicationV2) {
  #closed = false;
  #renderScheduled = false;
  #renderGeneration = 0;

  constructor(token, options = {}) {
    super(options);
    this.token = token?.document ?? token;
    this.actor = token?.actor ?? this.token?.actor ?? null;
  }

  static DEFAULT_OPTIONS = {
    position: { left: HUD_LEFT, width: HUD_MIN_WIDTH },
    actions: {
      save: onSave,
      item: onItem,
      cast: onCast
    },
    window: {
      icon: 'fa-solid fa-gear',
      contentClasses: ['swords-wizardry', 'swords-wizardry-combat-hud']
    }
  };

  static PARTS = {
    main: { template: `systems/${SYSTEM_ID}/module/hud/hud.hbs` }
  };

  static get instances() {
    return HUDS;
  }

  static start() {
    if (MANAGER_HOOKS.size) return;
    for (const event of MANAGER_EVENTS) {
      const callback = managerCallback(event);
      MANAGER_HOOKS.set(event, Hooks.on(event, callback));
    }
  }

  static async stop() {
    for (const [event, id] of MANAGER_HOOKS) Hooks.off(event, id);
    MANAGER_HOOKS.clear();
    await this.closeAll();
  }

  static reconcile() {
    reconcileRequested = true;
    if (!reconcileTask) {
      reconcileTask = runReconcileQueue()
        .finally(() => { reconcileTask = null; });
    }
    return reconcileTask;
  }

  static async closeAll() {
    reconcileRequested = false;
    if (reconcileTask) await reconcileTask;
    await Promise.all([...HUDS.values()].map((hud) => hud.close()));
  }

  get id() {
    return `swords-wizardry-combat-hud-${String(this.token?.uuid ?? this.token?.id ?? '')
      .replace(/[^A-Za-z0-9_-]/g, '-')}`;
  }

  get title() {
    return game.i18n.format('SWORDS_WIZARDRY.Hud.Title', {
      name: this.actor?.name ?? ''
    });
  }

  _prepareContext() {
    return {
      token: this.token,
      actor: this.actor,
      useAscendingAC: game.settings.get(SYSTEM_ID, 'useAscendingAC')
    };
  }

  _onRender(context, options) {
    if (typeof super._onRender === 'function') super._onRender(context, options);
    const rect = this.element?.getBoundingClientRect?.();
    if (!rect) return;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const firstRender = options?.isFirstRender === true;
    const availableWidth = Math.max(0, viewportWidth - (HUD_LEFT * 2));
    const maximumWidth = Math.min(HUD_MAX_WIDTH, availableWidth);
    const minimumWidth = Math.min(HUD_MIN_WIDTH, maximumWidth);
    const width = clamp(
      measureHudFrameWidth(this.element, rect),
      minimumWidth,
      maximumWidth
    );
    const maximumLeft = Math.max(0, viewportWidth - width);
    this.setPosition({
      left: firstRender
        ? clamp(HUD_LEFT, 0, maximumLeft)
        : clamp(rect.left, 0, maximumLeft),
      top: firstRender
        ? Math.max(0, (viewportHeight - rect.height) / 2)
        : clamp(rect.top, 0, Math.max(0, viewportHeight - rect.height)),
      width
    });
  }

  scheduleRender() {
    if (this.#closed || this.#renderScheduled) return;
    this.#renderScheduled = true;
    const generation = this.#renderGeneration;
    queueMicrotask(() => {
      this.#renderScheduled = false;
      if (this.#closed || generation !== this.#renderGeneration) return;
      void this.render(false, { focus: false });
    });
  }

  async close(options = {}) {
    if (this.#closed) return this;
    this.#closed = true;
    this.#renderGeneration += 1;
    if (HUDS.get(this.token?.uuid) === this) HUDS.delete(this.token.uuid);
    return super.close(options);
  }
}

function measureHudFrameWidth(element, frameRect) {
  const content = element?.querySelector?.('.combat-hud');
  const contentRect = content?.getBoundingClientRect?.();
  if (!content || !contentRect) return frameRect.width;

  let naturalContentWidth = content.querySelector?.('.combat-hud__status')?.scrollWidth ?? 0;
  for (const button of content.querySelectorAll?.('.combat-hud-list button') ?? []) {
    const image = button.querySelector?.('img');
    const label = button.querySelector?.('span');
    if (!label) continue;
    const style = getComputedStyle(button);
    const imageWidth = image?.getBoundingClientRect?.().width ?? 0;
    const gap = image ? cssPixels(style.columnGap || style.gap) : 0;
    const horizontalPadding = cssPixels(style.paddingLeft) + cssPixels(style.paddingRight);
    naturalContentWidth = Math.max(
      naturalContentWidth,
      imageWidth + gap + label.scrollWidth + horizontalPadding
    );
  }

  const windowChromeWidth = Math.max(0, frameRect.width - contentRect.width);
  return Math.ceil(naturalContentWidth + windowChromeWidth);
}

function cssPixels(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function onSave() {
  return this.actor?.rollSave?.();
}

async function onItem(_event, target) {
  const item = this.actor?.items?.get?.(target?.dataset?.itemId);
  return item?.roll?.();
}

async function onCast(_event, target) {
  const item = this.actor?.items?.get?.(target?.dataset?.itemId);
  return item?.cast?.();
}

function managerCallback(event) {
  if (event === 'controlToken' || event === 'canvasReady') {
    return () => { void CombatHud.reconcile(); };
  }
  if (event === 'canvasTearDown') {
    return () => { void CombatHud.closeAll(); };
  }
  if (event === 'deleteToken') {
    return () => { void CombatHud.reconcile(); };
  }
  return (document) => {
    const actor = document?.documentName === 'Actor'
      ? document
      : document?.actor ?? document?.parent;
    if (!actor?.uuid) return;
    for (const hud of HUDS.values()) {
      if (hud.actor?.uuid === actor.uuid) hud.scheduleRender();
    }
  };
}

async function runReconcileQueue() {
  while (reconcileRequested) {
    reconcileRequested = false;
    await reconcileOnce();
  }
}

async function reconcileOnce() {
  const controlled = globalThis.canvas?.ready
    ? Array.from(globalThis.canvas.tokens?.controlled ?? [])
    : [];
  const desired = new Map();
  for (const token of controlled) {
    const document = token?.document ?? token;
    if (document?.uuid && (token?.actor ?? document.actor)) {
      desired.set(document.uuid, token);
    }
  }

  for (const [uuid, hud] of [...HUDS]) {
    if (!desired.has(uuid)) await hud.close();
  }
  for (const [uuid, token] of desired) {
    if (HUDS.has(uuid)) continue;
    const hud = new CombatHud(token);
    HUDS.set(uuid, hud);
    await hud.render(true, { focus: false });
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}
