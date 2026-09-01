/**
 * Register all of the system's settings
 */
export function registerSystemSettings() {
  // Use ascending Armor Class
  game.settings.register("swords-wizardry", "useAscendingAC", {
    name: "SWORDS_WIZARDRY.Settings.UseAscendingAC.Name",
    hint: "SWORDS_WIZARDRY.Settings.UseAscendingAC.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    requiresReload: true,
    default: false
  });

  // DM must apply damage / healing
  game.settings.register("swords-wizardry", "dmAppliesDamage", {
    name: "SWORDS_WIZARDRY.Settings.DmAppliesDamage.Name",
    hint: "SWORDS_WIZARDRY.Settings.DmAppliesDamage.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    requiresReload: false,
    default: false
  });

  // Show welcome message on startup
  game.settings.register("swords-wizardry", "showWelcome", {
    name: "SWORDS_WIZARDRY.Settings.ShowWelcome.Name",
    hint: "SWORDS_WIZARDRY.Settings.ShowWelcome.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    requiresReload: false,
    default: true
  });

  // Store system version to show welcome message on startup when the version jumps
  game.settings.register("swords-wizardry", "systemVersion", {
    name: "SWORDS_WIZARDRY.Settings.SystemVersion.Name",
    scope: "world",
    type: String,
    requiresReload: false,
    default: '4.0.0'
  });

  game.settings.register("swords-wizardry", "debug", {
    name: "SWORDS_WIZARDRY.Settings.Debug.Name",
    hint: "SWORDS_WIZARDRY.Settings.Debug.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    requiresReload: false,
    default: false
  });

}
