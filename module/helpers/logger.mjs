const SYSTEM_ID = 'swords-wizardry';
const PREFIX = 'Swords & Wizardry |';

export function debug(message, ...details) {
  if (globalThis.game?.settings?.get?.(SYSTEM_ID, 'debug') !== true) return;
  console.debug(PREFIX, message, ...details);
}

export function reportError(message, error) {
  console.error(PREFIX, message, error);
}
