export function notifyOperationFailure(result, namespaces = []) {
  if (!result || ['success', 'duplicate'].includes(result.status)) return result;
  const code = result.code ?? 'UNKNOWN';
  const candidates = [...namespaces, 'SWORDS_WIZARDRY.Authority.Error']
    .map((namespace) => `${namespace}.${code}`);
  let message = '';
  for (const key of candidates) {
    const localized = game.i18n.localize(key);
    if (localized !== key) {
      message = localized;
      break;
    }
  }
  if (!message) {
    message = game.i18n.localize('SWORDS_WIZARDRY.Authority.Error.UNKNOWN');
  }
  const level = result.status === 'unsafe' ? 'error' : 'warn';
  ui.notifications?.[level]?.(message);
  return result;
}
