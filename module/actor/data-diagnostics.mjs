export function findNegativeTangibleValues(actors) {
  const findings = [];
  for (const actor of actors ?? []) {
    for (const item of actor?.items ?? []) {
      if (!['item', 'weapon', 'armor'].includes(item?.type)) continue;
      const source = item._source?.system ?? {};
      const fields = {};
      for (const field of ['quantity', 'weight']) {
        const value = Number(source[field]);
        if (Number.isFinite(value) && value < 0) fields[field] = value;
      }
      if (!Object.keys(fields).length) continue;
      findings.push({
        actorUuid: actor.uuid,
        itemUuid: item.uuid,
        itemName: item.name,
        fields
      });
    }
  }
  return findings;
}
