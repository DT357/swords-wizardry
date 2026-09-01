export function classifyInitiativeSide(disposition) {
  return Number(disposition) > 0 ? 'party' : 'opponent';
}

export function planSideInitiativeUpdates(combatants, { partyTotal, opponentTotal }) {
  const party = normalizeTotal(partyTotal);
  const opponent = normalizeTotal(opponentTotal);
  const updates = [];
  for (const combatant of combatants ?? []) {
    if (!combatant?.id || !combatant.token) continue;
    updates.push({
      _id: combatant.id,
      initiative: classifyInitiativeSide(combatant.token.disposition) === 'party'
        ? party
        : opponent
    });
  }
  return updates;
}

function normalizeTotal(value) {
  const total = Number(value);
  if (!Number.isFinite(total)) throw new TypeError('INVALID_INITIATIVE_TOTAL');
  return total;
}
