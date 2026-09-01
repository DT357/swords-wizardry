export function getEquippedArmorBonus(items) {
  let bonus = 0;
  for (const item of items ?? []) {
    if (item?.type !== 'armor' || item.system?.equipped === false) continue;
    const effect = Number(item.system?.effectOnAC ?? 0);
    if (!Number.isSafeInteger(effect)) continue;
    const nextBonus = bonus + effect;
    if (Number.isSafeInteger(nextBonus)) bonus = nextBonus;
  }
  return bonus;
}

export function calculateArmorClass(system, items) {
  const ac = Number(system?.ac?.value);
  const aac = Number(system?.aac?.value);
  const bonus = getEquippedArmorBonus(items);
  return {
    ac: Number.isSafeInteger(ac) ? ac - bonus : ac,
    aac: Number.isSafeInteger(aac) ? aac + bonus : aac,
    bonus
  };
}

export function normalizeArmorClassSheetUpdate(changed, bonus, options = {}) {
  const sheetOptions = options.swordsWizardry;
  if (!sheetOptions || !Object.hasOwn(sheetOptions, 'changedField')) return changed;

  const changedField = sheetOptions.changedField;
  if (changedField === 'system.ac.value' && changed.ac?.value !== undefined) {
    changed.ac.value = Number(changed.ac.value) + bonus;
    delete changed.aac;
  } else if (
    changedField === 'system.aac.value'
    && changed.aac?.value !== undefined
  ) {
    changed.aac.value = Number(changed.aac.value) - bonus;
    delete changed.ac;
  } else {
    delete changed.ac;
    delete changed.aac;
  }
  return changed;
}
