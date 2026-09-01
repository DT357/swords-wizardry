const V14_MODES = Object.freeze({
  publicroll: 'public',
  gmroll: 'gm',
  blindroll: 'blind',
  selfroll: 'self'
});
const V13_MODES = Object.freeze({
  public: 'publicroll',
  gm: 'gmroll',
  blind: 'blindroll',
  self: 'selfroll'
});

export function readFoundryRollMode(settings) {
  if (typeof settings?.get !== 'function') {
    throw new TypeError('Foundry settings are unavailable.');
  }
  const key = settings.settings?.has?.('core.messageMode')
    ? 'messageMode'
    : 'rollMode';
  return settings.get('core', key);
}

export function applyFoundryChatVisibility(ChatMessageClass, data) {
  const { rollMode, ...source } = data;
  const { rolls, ...cloneableSource } = source;
  const chatData = structuredCloneSafe(cloneableSource);
  if (rolls !== undefined) chatData.rolls = [...rolls];
  if (typeof ChatMessageClass?.applyMode === 'function') {
    return ChatMessageClass.applyMode(chatData, V14_MODES[rollMode] ?? rollMode) ?? chatData;
  }
  if (typeof ChatMessageClass?.applyRollMode === 'function') {
    return ChatMessageClass.applyRollMode(chatData, V13_MODES[rollMode] ?? rollMode) ?? chatData;
  }
  throw new TypeError('ChatMessage visibility API is unavailable.');
}

function structuredCloneSafe(value) {
  if (typeof globalThis.structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
