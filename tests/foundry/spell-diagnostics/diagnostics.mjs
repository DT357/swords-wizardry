const DIAGNOSTIC_ID = 'swords-wizardry-spell-diagnostics';
const SYSTEM_ID = 'swords-wizardry';
const FIXTURE_FLAG = 'fixture';
const FIXTURE_PREFIX = '[SW Fix Diagnostic]';

let lastReport = null;

Hooks.once('ready', () => {
  const module = game.modules.get(DIAGNOSTIC_ID);
  if (!module) return;
  module.api = Object.freeze({
    run: runDiagnostics,
    cleanup: cleanupDiagnostics,
    getLastReport: () => structuredClone(lastReport)
  });
  console.info(`${FIXTURE_PREFIX} Ready.`);
});

async function runDiagnostics({ retainFixtures = false, ownerUserId = null } = {}) {
  assertDisposableGM();
  await cleanupDiagnostics();
  const tracked = new Set();
  const tests = [];
  const fixtures = {};
  const startedAt = new Date().toISOString();
  const owner = resolveFixtureOwner(ownerUserId);
  const ownership = owner
    ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [owner.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    : { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  const originalManualSetting = game.settings.get(SYSTEM_ID, 'dmAppliesDamage');

  try {
    await game.settings.set(SYSTEM_ID, 'dmAppliesDamage', true);
    const caster = track(tracked, await Actor.implementation.create({
      name: `${FIXTURE_PREFIX} Caster`,
      type: 'character',
      system: { hp: { value: 12, max: 12 }, save: { value: 10 }, level: { value: 5 } },
      ownership,
      flags: diagnosticFlags()
    }));
    const target = track(tracked, await Actor.implementation.create({
      name: `${FIXTURE_PREFIX} Target`,
      type: 'npc',
      system: {
        hd: '2d8', hp: { value: 20, max: 20 }, ac: { value: 100 }, aac: { value: -100 },
        morale: 7, save: { value: 18 }
      },
      ownership,
      flags: diagnosticFlags()
    }));
    const tokenHpActor = track(tracked, await Actor.implementation.create({
      name: `${FIXTURE_PREFIX} Token HP`,
      type: 'npc',
      system: { hd: '1d1+4', hp: { value: 0, max: 0 }, ac: { value: 9 }, aac: { value: 10 } },
      flags: diagnosticFlags()
    }));
    expect(caster && target && tokenHpActor, 'Fixture Actors were not created.');
    record(tests, 'real system Actor DataModels create character and NPC fixtures', true);

    const createdItems = await caster.createEmbeddedDocuments('Item', [
      spellFixture(`${FIXTURE_PREFIX} Arcane Bolt`, [
        spellAction('diagnostic-damage', 'damage', '2'),
        {
          ...spellAction('diagnostic-attack', 'attack', '1d20 + 100'),
          attack: { mode: 'melee', notes: '' }
        },
        spellAction('diagnostic-roll', 'roll', '1', 'none')
      ]),
      spellFixture(`${FIXTURE_PREFIX} Cure Wounds`, [
        spellAction('diagnostic-healing', 'healing', '3')
      ]),
      {
        name: `${FIXTURE_PREFIX} Sure Strike`, type: 'weapon', img: 'icons/svg/sword.svg',
        system: { damageFormula: '2', modifier: 100, specialDamage: '', missile: false, quantity: 1, weight: 0 }
      },
      {
        name: `${FIXTURE_PREFIX} Blank Feature`, type: 'feature', img: 'icons/svg/book.svg',
        system: { formula: '', description: '<p>Diagnostic feature description.</p>' }
      },
      {
        name: `${FIXTURE_PREFIX} Threshold Feature`, type: 'feature', img: 'icons/svg/book.svg',
        system: {
          formula: '1d1', target: 1, targetType: 'descending',
          description: '<p>Diagnostic rollable feature description.</p>'
        }
      },
      {
        name: `${FIXTURE_PREFIX} Test Armor`, type: 'armor',
        img: 'systems/swords-wizardry/assets/game-icons-net/chest-armor.svg',
        system: { description: '<p>Diagnostic armor description.</p>', effectOnAC: 1 }
      },
      {
        name: `${FIXTURE_PREFIX} Test Item`, type: 'item',
        img: 'systems/swords-wizardry/assets/game-icons-net/swap-bag.svg',
        system: { description: '<p>Diagnostic item description.</p>' }
      }
    ]);
    const [targetArmor] = await target.createEmbeddedDocuments('Item', [{
      name: `${FIXTURE_PREFIX} NPC Armor`, type: 'armor',
      img: 'systems/swords-wizardry/assets/game-icons-net/chest-armor.svg',
      system: { effectOnAC: 2, equipped: true }
    }]);
    const damageSpell = createdItems.find((item) => item.name === `${FIXTURE_PREFIX} Arcane Bolt`);
    const healingSpell = createdItems.find((item) => item.name === `${FIXTURE_PREFIX} Cure Wounds`);
    const weapon = createdItems.find((item) => item.name === `${FIXTURE_PREFIX} Sure Strike`);
    const feature = createdItems.find((item) => item.name === `${FIXTURE_PREFIX} Blank Feature`);
    const thresholdFeature = createdItems.find(
      (item) => item.name === `${FIXTURE_PREFIX} Threshold Feature`
    );
    const armor = createdItems.find((item) => item.name === `${FIXTURE_PREFIX} Test Armor`);
    const item = createdItems.find((entry) => entry.name === `${FIXTURE_PREFIX} Test Item`);
    Object.assign(fixtures, {
      ownerUserId: owner?.id ?? null,
      casterUuid: caster.uuid,
      targetActorUuid: target.uuid,
      damageSpellUuid: damageSpell.uuid,
      healingSpellUuid: healingSpell.uuid,
      weaponUuid: weapon.uuid,
      featureUuid: feature.uuid,
      thresholdFeatureUuid: thresholdFeature.uuid,
      armorUuid: armor.uuid,
      targetArmorUuid: targetArmor.uuid,
      itemUuid: item.uuid
    });
    const itemFieldsPersist = (
      damageSpell.system.actions[0].kind === 'damage'
      && weapon.system.damageFormula === '2'
      && feature.system.formula === ''
      && thresholdFeature.system.formula === '1d1'
      && armor.system.equipped === true
      && targetArmor.system.equipped === true
      && armor.system.description.includes('Diagnostic armor')
      && item.system.description.includes('Diagnostic item')
    );
    record(
      tests,
      'embedded spell, weapon, and feature Items persist current DataModel fields',
      itemFieldsPersist,
      itemFieldsPersist ? null : new Error(JSON.stringify({
        spellKind: damageSpell.system.actions[0].kind,
        weaponDamageFormula: weapon.system.damageFormula,
        featureFormula: feature.system.formula,
        thresholdFeatureFormula: thresholdFeature.system.formula,
        armorDescription: armor.system.description,
        itemDescription: item.system.description
      }))
    );

    await caster.update({
      'system.spellSlots.1.max': 2,
      'system.spellSlots.1.memorized': [damageSpell.id, damageSpell.id]
    });

    const scene = track(tracked, await Scene.implementation.create({
      name: `${FIXTURE_PREFIX} Scene`, active: false, navigation: false,
      flags: diagnosticFlags()
    }));
    const tokenSources = [];
    for (const [actor, name] of [
      [caster, `${FIXTURE_PREFIX} Caster Token`],
      [target, `${FIXTURE_PREFIX} Target Token`],
      [tokenHpActor, `${FIXTURE_PREFIX} Generated HP Token`]
    ]) {
      const source = (await actor.getTokenDocument({
        name, actorLink: false, x: tokenSources.length * 200, y: 0
      })).toObject();
      delete source._id;
      tokenSources.push(source);
    }
    const createdTokens = await scene.createEmbeddedDocuments('Token', tokenSources);
    const casterToken = createdTokens.find((token) => token.name === `${FIXTURE_PREFIX} Caster Token`);
    const targetToken = createdTokens.find((token) => token.name === `${FIXTURE_PREFIX} Target Token`);
    const generatedHpToken = createdTokens.find((token) => token.name === `${FIXTURE_PREFIX} Generated HP Token`);
    expect(casterToken && targetToken && generatedHpToken, 'Fixture Tokens were not created.');
    Object.assign(fixtures, {
      sceneUuid: scene.uuid,
      casterTokenUuid: casterToken.uuid,
      targetTokenUuid: targetToken.uuid,
      generatedHpTokenUuid: generatedHpToken.uuid
    });
    const tokenHpPersists = (
      generatedHpToken.actor?.system?.hp?.value === 5
      && generatedHpToken.actor?.system?.hp?.max === 5
    );
    record(
      tests,
      'unlinked NPC Token HP is written to ActorDelta during creation',
      tokenHpPersists,
      tokenHpPersists ? null : new Error(JSON.stringify({
        actorLink: generatedHpToken.actorLink,
        baseHp: generatedHpToken.baseActor?.system?.hp,
        deltaHp: generatedHpToken.delta?.system?.hp,
        syntheticHp: generatedHpToken.actor?.system?.hp
      }))
    );

    const posted = await game.swordswizardry.spells.post(damageSpell, {
      targetUuids: [targetToken.uuid]
    });
    expectSuccess(posted, 'Spell post');
    await tagMessage(posted.message, tracked);
    fixtures.postMessageId = posted.message.id;
    record(tests, 'posting creates a current-schema spell card without consuming preparation', (
      posted.message.getFlag(SYSTEM_ID, 'spell')?.schemaVersion === 2
      && caster.system.spellSlots[1].memorized.length === 2
    ));

    const cast = await game.swordswizardry.spells.cast(damageSpell, {
      targetUuids: [targetToken.uuid]
    });
    expectSuccess(cast, 'Spell cast');
    await tagMessage(cast.message, tracked);
    fixtures.castMessageId = cast.message.id;
    record(tests, 'authoritative cast consumes exactly one prepared occurrence', (
      caster.system.spellSlots[1].memorized.length === 1
      && cast.message.getFlag(SYSTEM_ID, 'spell')?.consumption?.status === 'consumed'
    ));

    const manualDamage = await game.swordswizardry.spells.invoke(
      cast.message, 'diagnostic-damage',
      { targetUuids: [targetToken.uuid], rollMode: 'publicroll' }
    );
    expectSuccess(manualDamage, 'Manual spell damage result');
    const damageMessage = await fromUuid(manualDamage.messageUuid);
    await tagMessage(damageMessage, tracked);
    fixtures.manualDamageMessageId = damageMessage.id;
    fixtures.manualDamageMessageUuid = damageMessage.uuid;
    record(tests, 'manual spell damage creates a GM-authored pending HP result', (
      damageMessage.author?.isGM === true
      && damageMessage.getFlag(SYSTEM_ID, 'spell')?.messageKind === 'spell-result'
      && targetToken.actor.system.hp.value === 20
    ));

    const spellAttack = await game.swordswizardry.spells.invoke(
      cast.message, 'diagnostic-attack',
      { targetUuids: [targetToken.uuid], rollMode: 'publicroll' }
    );
    expectSuccess(spellAttack, 'Spell attack result');
    const spellAttackMessage = spellAttack.message
      ?? await fromUuid(spellAttack.messageUuid);
    await tagMessage(spellAttackMessage, tracked);
    fixtures.spellAttackMessageId = spellAttackMessage.id;
    record(tests, 'targeted spell attacks render a localized punctuated outcome', (
      spellAttackMessage.content.includes('<strong class="spell-result__target-name">')
      && /(?:Hit|Miss)!/.test(spellAttackMessage.content)
    ));

    const healingCard = await game.swordswizardry.spells.post(healingSpell, {
      targetUuids: [targetToken.uuid]
    });
    expectSuccess(healingCard, 'Healing card');
    await tagMessage(healingCard.message, tracked);
    fixtures.healingCardMessageId = healingCard.message.id;
    const manualHealing = await game.swordswizardry.spells.invoke(
      healingCard.message, 'diagnostic-healing',
      { targetUuids: [targetToken.uuid], rollMode: 'publicroll' }
    );
    expectSuccess(manualHealing, 'Manual spell healing result');
    const healingMessage = await fromUuid(manualHealing.messageUuid);
    await tagMessage(healingMessage, tracked);
    fixtures.manualHealingMessageId = healingMessage.id;
    record(tests, 'manual spell healing creates a trusted healing-only result', (
      healingMessage.author?.isGM === true
      && healingMessage.getFlag(SYSTEM_ID, 'spell')?.action?.kind === 'healing'
    ));

    const attack = await game.swordswizardry.weapons.attack(weapon, {
      targetUuids: [targetToken.uuid], rollMode: 'publicroll'
    });
    expectSuccess(attack, 'Weapon attack');
    const attackMessage = await fromUuid(attack.messageUuid);
    await tagMessage(attackMessage, tracked);
    fixtures.weaponAttackMessageId = attackMessage.id;
    const damage = await game.swordswizardry.weapons.damage(attackMessage);
    expectSuccess(damage, 'Weapon damage');
    const weaponDamageMessage = await fromUuid(damage.messageUuid);
    await tagMessage(weaponDamageMessage, tracked);
    fixtures.weaponDamageMessageId = weaponDamageMessage.id;
    record(tests, 'weapon attack snapshots hits and damage reuses that trusted snapshot', (
      attackMessage.getFlag(SYSTEM_ID, 'weapon')?.hitTargetUuids?.[0] === targetToken.uuid
      && weaponDamageMessage.getFlag(SYSTEM_ID, 'weapon')?.targetUuids?.[0] === targetToken.uuid
    ));

    const beforeDescriptionMessages = game.messages.size;
    const featureResult = await game.swordswizardry.rolls.feature(feature);
    expectSuccess(featureResult, 'Description-only feature');
    await tagMessage(featureResult.message, tracked);
    fixtures.featureMessageId = featureResult.message.id;
    const thresholdFeatureResult = await game.swordswizardry.rolls.feature(thresholdFeature);
    expectSuccess(thresholdFeatureResult, 'Threshold feature');
    await tagMessage(thresholdFeatureResult.message, tracked);
    fixtures.thresholdFeatureMessageId = thresholdFeatureResult.message.id;
    record(tests, 'feature cards retain identity and descriptions with and without rolls', (
      game.messages.size === beforeDescriptionMessages + 2
      && featureResult.message.rolls?.length === 0
      && featureResult.message.content.includes(feature.name)
      && featureResult.message.content.includes('Diagnostic feature description.')
      && thresholdFeatureResult.message.rolls?.length === 1
      && thresholdFeatureResult.message.content.includes(thresholdFeature.name)
      && thresholdFeatureResult.message.content.includes('Diagnostic rollable feature description.')
      && thresholdFeatureResult.message.content.includes('threshold-roll-card__result')
    ));

    const armorMessage = await armor.roll();
    const itemMessage = await item.roll();
    await tagMessage(armorMessage, tracked);
    await tagMessage(itemMessage, tracked);
    fixtures.armorMessageId = armorMessage.id;
    fixtures.itemMessageId = itemMessage.id;
    record(tests, 'Armor and Item descriptions use structured identity cards', (
      armorMessage.content.includes(armor.name)
      && armorMessage.content.includes('Diagnostic armor description.')
      && itemMessage.content.includes(item.name)
      && itemMessage.content.includes('Diagnostic item description.')
      && armorMessage.content.includes('data-item-message-kind="item-description"')
      && itemMessage.content.includes('data-item-message-kind="item-description"')
    ));
    const saveResult = await game.swordswizardry.rolls.save(caster);
    expectSuccess(saveResult, 'Saving throw');
    await tagMessage(saveResult.message, tracked);
    const moraleCount = game.messages.size;
    const moraleResult = await game.swordswizardry.rolls.morale(target);
    expectSuccess(moraleResult, 'Morale roll');
    const moraleMessage = game.messages.contents.at(-1);
    await tagMessage(moraleMessage, tracked);
    record(tests, 'save and hidden morale rolls create one message each', (
      saveResult.message.speaker?.actor === caster.id
      && game.messages.size === moraleCount + 1
      && (moraleMessage.whisper?.length ?? 0) > 0
    ));

    const combat = track(tracked, await Combat.implementation.create({
      scene: scene.id, active: false, flags: diagnosticFlags()
    }));
    await combat.createEmbeddedDocuments('Combatant', [
      { tokenId: casterToken.id, actorId: caster.id, sceneId: scene.id },
      { tokenId: targetToken.id, actorId: target.id, sceneId: scene.id }
    ]);
    const combatResult = await combat.rollSideInitiative();
    expectSuccess(combatResult, 'Side initiative');
    await tagMessage(combatResult.message, tracked);
    record(tests, 'side initiative updates both sides and creates one public message', (
      [...combat.combatants].every((combatant) => Number.isFinite(combatant.initiative))
      && combatResult.message.rolls?.length === 2
    ));
  } catch (error) {
    record(tests, 'diagnostic execution', false, error);
  } finally {
    await game.settings.set(SYSTEM_ID, 'dmAppliesDamage', originalManualSetting).catch(() => {});
  }

  let cleanup = { status: 'retained', deleted: 0, failures: [] };
  if (!retainFixtures) {
    cleanup = await deleteTracked(tracked);
    const sweep = await cleanupDiagnostics();
    cleanup.deleted += sweep.deleted;
    cleanup.failures.push(...sweep.failures);
    cleanup.status = cleanup.failures.length ? 'failed' : 'success';
  }
  lastReport = {
    schemaVersion: 2,
    startedAt,
    finishedAt: new Date().toISOString(),
    foundryVersion: game.version,
    systemVersion: game.system.version,
    passed: tests.filter((entry) => entry.status === 'passed').length,
    failed: tests.filter((entry) => entry.status === 'failed').length,
    tests,
    cleanup,
    fixtures: retainFixtures ? fixtures : null
  };
  console.table(lastReport.tests);
  return structuredClone(lastReport);
}

async function cleanupDiagnostics() {
  assertDisposableGM();
  const failures = [];
  let deleted = 0;
  for (const collection of [game.combats, game.messages, game.scenes, game.actors]) {
    const documents = collection?.filter((document) => (
      document.getFlag?.(DIAGNOSTIC_ID, FIXTURE_FLAG) === true
      || String(document.name ?? '').startsWith(FIXTURE_PREFIX)
    )) ?? [];
    for (const document of documents) {
      try {
        await document.delete();
        deleted += 1;
      } catch (error) {
        failures.push({ uuid: document.uuid, message: errorMessage(error) });
      }
    }
  }
  return { status: failures.length ? 'failed' : 'success', deleted, failures };
}

function spellFixture(name, actions) {
  return {
    name, type: 'spell', img: 'icons/svg/book.svg',
    system: {
      description: '<p>Diagnostic fixture. Safe to delete.</p>',
      spellLevel: 1, range: '120 feet', duration: 'Instantaneous',
      casting: { levelSource: 'fixed', fixedLevel: 5 }, actions
    }
  };
}

function spellAction(id, kind, formula, targetMode = 'single') {
  return {
    id, kind, label: `${FIXTURE_PREFIX} ${kind}`, formula,
    target: { mode: targetMode }, save: { outcome: 'none', notes: '' },
    attack: { mode: 'none', notes: '' }, effect: { reference: '' }, notes: ''
  };
}

function resolveFixtureOwner(ownerUserId) {
  if (!ownerUserId) return null;
  const owner = game.users.get(String(ownerUserId));
  if (!owner || owner.isGM) throw new Error('Fixture owner must be an existing non-GM user.');
  return owner;
}

function assertDisposableGM() {
  if (!game.user?.isGM) throw new Error('Diagnostics require a GM.');
  if (game.system?.id !== SYSTEM_ID) throw new Error(`Expected system ${SYSTEM_ID}.`);
}

function diagnosticFlags() {
  return { [DIAGNOSTIC_ID]: { [FIXTURE_FLAG]: true } };
}

function track(tracked, document) {
  if (document) tracked.add(document);
  return document;
}

async function tagMessage(message, tracked) {
  if (!message) return;
  track(tracked, message);
  await message.setFlag(DIAGNOSTIC_ID, FIXTURE_FLAG, true);
}

async function deleteTracked(tracked) {
  const failures = [];
  let deleted = 0;
  for (const document of [...tracked].reverse()) {
    if (!document || document.deleted) continue;
    try {
      await document.delete();
      deleted += 1;
    } catch (error) {
      failures.push({ uuid: document.uuid, message: errorMessage(error) });
    }
  }
  return { status: failures.length ? 'failed' : 'success', deleted, failures };
}

function expectSuccess(result, label) {
  if (result?.status !== 'success') {
    const detail = result?.error?.message ? ` (${result.error.message})` : '';
    throw new Error(
      `${label} failed: ${result?.code ?? result?.status ?? 'unknown'}${detail}`
    );
  }
}

function expect(value, message) {
  if (!value) throw new Error(message);
}

function record(tests, name, passed, error = null) {
  tests.push({
    name,
    status: passed ? 'passed' : 'failed',
    ...(error ? { message: errorMessage(error) } : {})
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
