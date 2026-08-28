const DIAGNOSTIC_ID = 'swords-wizardry-spell-diagnostics';
const SYSTEM_ID = 'swords-wizardry';
const FIXTURE_FLAG = 'fixture';
const FIXTURE_PREFIX = '[SW Spell Diagnostic]';

let lastReport = null;

Hooks.once('ready', () => {
  const module = game.modules.get(DIAGNOSTIC_ID);
  if (!module) return;
  module.api = Object.freeze({
    run: runSpellDiagnostics,
    cleanup: cleanupSpellDiagnostics,
    getLastReport: () => structuredCopy(lastReport)
  });
  console.info(`${FIXTURE_PREFIX} Ready. Run game.modules.get('${DIAGNOSTIC_ID}').api.run().`);
});

async function runSpellDiagnostics({ retainFixtures = false, ownerUserId = null } = {}) {
  if (!game.user?.isGM) {
    throw new Error('The spell diagnostic suite must be run by a GM.');
  }
  if (game.system?.id !== SYSTEM_ID) {
    throw new Error(`Expected system ${SYSTEM_ID}, received ${game.system?.id ?? 'none'}.`);
  }

  await cleanupSpellDiagnostics();
  const trackedDocuments = new Set();
  const tests = [];
  const startedAt = new Date().toISOString();
  const owner = resolveFixtureOwner(ownerUserId);
  const fixtureOwnership = owner
    ? { [owner.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    : {};
  const fixtures = { ownerUserId: owner?.id ?? null };
  const originalDmAppliesDamage = game.settings.get(SYSTEM_ID, 'dmAppliesDamage');
  let changedDamageSetting = false;

  try {
    if (!originalDmAppliesDamage) {
      await game.settings.set(SYSTEM_ID, 'dmAppliesDamage', true);
      changedDamageSetting = true;
    }
    const caster = track(trackedDocuments, await Actor.implementation.create({
      name: `${FIXTURE_PREFIX} Caster`,
      type: 'character',
      system: { hp: { value: 8, max: 8 } },
      ownership: fixtureOwnership,
      flags: diagnosticFlags()
    }));
    const target = track(trackedDocuments, await Actor.implementation.create({
      name: `${FIXTURE_PREFIX} Target`,
      type: 'npc',
      system: { hp: { value: 10, max: 10 }, ac: { value: 7 }, aac: { value: 12 } },
      flags: diagnosticFlags()
    }));
    record(tests, 'fixture actors use real system DataModels', Boolean(caster && target));

    const createdSpells = await caster.createEmbeddedDocuments('Item', [
      spellFixture({
        name: `${FIXTURE_PREFIX} Arcane Bolt`,
        actions: [
          spellAction({ id: 'diagnostic-damage', kind: 'damage', formula: '2' }),
          spellAction({
            id: 'diagnostic-roll',
            kind: 'roll',
            label: 'Diagnostic no-target roll',
            formula: '1',
            targetMode: 'none'
          })
        ]
      }),
      spellFixture({
        name: `${FIXTURE_PREFIX} Cure Wounds`,
        action: spellAction({ id: 'diagnostic-healing', kind: 'healing', formula: '3' })
      })
    ]);
    const damageSpell = createdSpells.find((item) => item.system.actions[0]?.kind === 'damage');
    const healingSpell = createdSpells.find((item) => item.system.actions[0]?.kind === 'healing');
    expect(damageSpell && healingSpell, 'Fixture spell creation failed.');
    Object.assign(fixtures, {
      casterUuid: caster.uuid,
      damageSpellUuid: damageSpell.uuid,
      healingSpellUuid: healingSpell.uuid
    });
    record(tests, 'spell Items persist casting and action data', (
      damageSpell.system.casting.levelSource === 'fixed'
      && damageSpell.system.actions[0].kind === 'damage'
    ));

    await caster.update({
      'system.spellSlots.1.max': 2,
      'system.spellSlots.1.memorized': [damageSpell.id, damageSpell.id]
    });

    const scene = track(trackedDocuments, await Scene.implementation.create({
      name: `${FIXTURE_PREFIX} Scene`,
      active: false,
      navigation: false,
      flags: diagnosticFlags()
    }));
    const tokenDocument = await target.getTokenDocument({
      name: `${FIXTURE_PREFIX} Unlinked Target`,
      actorLink: false,
      x: 0,
      y: 0
    });
    const tokenSource = tokenDocument.toObject();
    delete tokenSource._id;
    const [token] = await scene.createEmbeddedDocuments('Token', [tokenSource]);
    expect(token?.actor?.isToken === true, 'Expected an unlinked synthetic Token Actor.');
    fixtures.targetTokenUuid = token.uuid;
    record(tests, 'fixture creates an unlinked synthetic Token Actor', true);

    const post = await game.swordswizardry.spells.post(damageSpell, {
      targetUuids: [token.uuid]
    });
    expectSuccess(post, 'Post');
    await tagMessage(post.message, trackedDocuments);
    fixtures.postMessageId = post.message.id;
    record(tests, 'Post creates a versioned spell card', (
      post.message.getFlag(SYSTEM_ID, 'spell')?.messageKind === 'spell-card'
    ));
    record(tests, 'Post does not consume preparation', (
      caster.system.spellSlots[1].memorized.length === 2
    ));

    const cast = await game.swordswizardry.spells.cast(damageSpell, {
      targetUuids: [token.uuid]
    });
    expectSuccess(cast, 'Cast');
    await tagMessage(cast.message, trackedDocuments);
    fixtures.castMessageId = cast.message.id;
    record(tests, 'Cast consumes exactly one prepared occurrence', (
      caster.system.spellSlots[1].memorized.length === 1
      && caster.system.spellSlots[1].memorized[0] === damageSpell.id
    ));

    const damageResult = await game.swordswizardry.spells.invoke(
      cast.message,
      'diagnostic-damage',
      { targetUuids: [token.uuid], rollMode: 'publicroll' }
    );
    expectSuccess(damageResult, 'Damage action');
    await tagMessage(damageResult.message, trackedDocuments);
    fixtures.damageResultMessageId = damageResult.message.id;
    record(tests, 'action result retains the target snapshot and formula result', (
      damageResult.result.targetUuids[0] === token.uuid
      && damageResult.result.result.total === 2
    ));
    record(tests, 'public roll mode creates a visible non-blind result', (
      hasExpectedVisibility(damageResult.message, 'publicroll')
    ));

    for (const rollMode of ['gmroll', 'blindroll', 'selfroll']) {
      const modeResult = await game.swordswizardry.spells.invoke(
        post.message,
        'diagnostic-damage',
        { targetUuids: [token.uuid], rollMode }
      );
      expectSuccess(modeResult, `${rollMode} action`);
      await tagMessage(modeResult.message, trackedDocuments);
      record(tests, `${rollMode} applies Foundry message visibility`, (
        hasExpectedVisibility(modeResult.message, rollMode)
      ));
    }

    const damageApplication = await game.swordswizardry.spells.requestApplication(
      damageResult.message,
      { targetUuid: token.uuid, kind: 'damage', multiplier: 1 }
    );
    expectSuccess(damageApplication, 'Damage application');
    record(tests, 'GM damage application updates the synthetic Actor', (
      token.actor.system.hp.value === 8
      && damageApplication.change.appliedAmount === 2
    ));

    const duplicateApplication = await game.swordswizardry.spells.requestApplication(
      damageResult.message,
      { targetUuid: token.uuid, kind: 'damage', multiplier: 1 }
    );
    record(tests, 'duplicate application is idempotent', (
      duplicateApplication.status === 'duplicate'
      && token.actor.system.hp.value === 8
    ));

    const healingCard = await game.swordswizardry.spells.post(healingSpell, {
      targetUuids: [token.uuid]
    });
    expectSuccess(healingCard, 'Healing post');
    await tagMessage(healingCard.message, trackedDocuments);
    const healingResult = await game.swordswizardry.spells.invoke(
      healingCard.message,
      'diagnostic-healing',
      { targetUuids: [token.uuid], rollMode: 'publicroll' }
    );
    expectSuccess(healingResult, 'Healing action');
    await tagMessage(healingResult.message, trackedDocuments);
    const healingApplication = await game.swordswizardry.spells.requestApplication(
      healingResult.message,
      { targetUuid: token.uuid, kind: 'healing', multiplier: 1 }
    );
    expectSuccess(healingApplication, 'Healing application');
    record(tests, 'healing clamps at maximum HP and audits the applied amount', (
      token.actor.system.hp.value === 10
      && healingApplication.change.requestedAmount === 3
      && healingApplication.change.appliedAmount === 2
    ));

    if (owner) {
      const permissionCard = await game.swordswizardry.spells.post(damageSpell, {
        targetUuids: [token.uuid]
      });
      expectSuccess(permissionCard, 'Permission card');
      await tagMessage(permissionCard.message, trackedDocuments);
      const pendingResult = await game.swordswizardry.spells.invoke(
        permissionCard.message,
        'diagnostic-damage',
        { targetUuids: [token.uuid], rollMode: 'publicroll' }
      );
      expectSuccess(pendingResult, 'Pending application result');
      await tagMessage(pendingResult.message, trackedDocuments);
      Object.assign(fixtures, {
        permissionCardMessageId: permissionCard.message.id,
        pendingResultMessageId: pendingResult.message.id,
        pendingResultMessageUuid: pendingResult.message.uuid
      });
      record(tests, 'retained permission fixture belongs to the selected player', (
        caster.ownership[owner.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      ));
    }
  } catch (error) {
    tests.push({
      name: 'diagnostic execution',
      status: 'failed',
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    let cleanup = { status: 'retained', deleted: 0, failures: [] };
    if (!retainFixtures) {
      cleanup = await deleteTrackedDocuments(trackedDocuments);
      const sweep = await cleanupSpellDiagnostics();
      cleanup.deleted += sweep.deleted;
      cleanup.failures.push(...sweep.failures);
      cleanup.status = cleanup.failures.length ? 'failed' : 'success';
    }
    if (changedDamageSetting) {
      try {
        await game.settings.set(SYSTEM_ID, 'dmAppliesDamage', originalDmAppliesDamage);
      } catch (error) {
        cleanup.failures.push({
          setting: `${SYSTEM_ID}.dmAppliesDamage`,
          message: error instanceof Error ? error.message : String(error)
        });
        cleanup.status = 'failed';
      }
    }
    lastReport = {
      schemaVersion: 1,
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
  }

  console.table(lastReport.tests);
  console.info(`${FIXTURE_PREFIX} Result`, lastReport);
  return structuredCopy(lastReport);
}

async function cleanupSpellDiagnostics() {
  if (!game.user?.isGM) {
    throw new Error('Diagnostic cleanup must be run by a GM.');
  }
  const failures = [];
  let deleted = 0;
  const fixtureCasterUuids = new Set(
    game.actors
      ?.filter((actor) => actor.getFlag(DIAGNOSTIC_ID, FIXTURE_FLAG) === true)
      .map((actor) => actor.uuid) ?? []
  );
  for (const collection of [game.messages, game.scenes, game.actors]) {
    const documents = collection?.filter((document) => (
      document.getFlag(DIAGNOSTIC_ID, FIXTURE_FLAG) === true
      || (
        document.documentName === 'ChatMessage'
        && fixtureCasterUuids.has(document.getFlag(SYSTEM_ID, 'spell')?.casterUuid)
      )
    )) ?? [];
    for (const document of documents) {
      try {
        await document.delete();
        deleted += 1;
      } catch (error) {
        failures.push({
          uuid: document.uuid,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return { status: failures.length ? 'failed' : 'success', deleted, failures };
}

function resolveFixtureOwner(ownerUserId) {
  if (ownerUserId == null || ownerUserId === '') return null;
  const owner = game.users.get(String(ownerUserId));
  if (!owner || owner.isGM) {
    throw new Error('The diagnostic fixture owner must be an existing non-GM user.');
  }
  return owner;
}

function spellFixture({ name, action, actions = [action].filter(Boolean) }) {
  return {
    name,
    type: 'spell',
    system: {
      description: '<p>Diagnostic fixture. Safe to delete.</p>',
      spellLevel: 1,
      range: '120 feet',
      duration: 'Instantaneous',
      casting: { levelSource: 'fixed', fixedLevel: 5 },
      actions
    },
    flags: diagnosticFlags()
  };
}

function spellAction({ id, kind, label, formula, targetMode = 'single' }) {
  return {
    id,
    kind,
    label: label ?? (kind === 'damage' ? 'Diagnostic damage' : 'Diagnostic healing'),
    formula,
    target: { mode: targetMode },
    save: { outcome: 'none', notes: '' },
    attack: { mode: 'none', notes: '' },
    effect: { reference: '' },
    notes: ''
  };
}

function diagnosticFlags() {
  return { [DIAGNOSTIC_ID]: { [FIXTURE_FLAG]: true } };
}

function track(documents, document) {
  if (document) documents.add(document);
  return document;
}

async function tagMessage(message, documents) {
  track(documents, message);
  await message.setFlag(DIAGNOSTIC_ID, FIXTURE_FLAG, true);
}

async function deleteTrackedDocuments(documents) {
  const failures = [];
  let deleted = 0;
  const order = { ChatMessage: 0, Scene: 1, Actor: 2 };
  const sorted = [...documents].sort((left, right) => (
    (order[left.documentName] ?? 99) - (order[right.documentName] ?? 99)
  ));
  for (const document of sorted) {
    if (!document?.id) continue;
    try {
      await document.delete();
      deleted += 1;
    } catch (error) {
      failures.push({
        uuid: document.uuid,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { deleted, failures };
}

function record(tests, name, condition) {
  tests.push({ name, status: condition ? 'passed' : 'failed' });
  if (!condition) throw new Error(`${name} failed.`);
}

function expectSuccess(result, label) {
  if (result?.status !== 'success') {
    throw new Error(`${label} failed with ${result?.code ?? result?.status ?? 'unknown error'}.`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function hasExpectedVisibility(message, rollMode) {
  const whisper = Array.from(message.whisper ?? []);
  if (rollMode === 'publicroll') return whisper.length === 0 && message.blind !== true;
  if (rollMode === 'selfroll') {
    return whisper.length === 1 && whisper[0] === game.user.id && message.blind !== true;
  }
  const includesCurrentGm = whisper.includes(game.user.id);
  return includesCurrentGm && message.blind === (rollMode === 'blindroll');
}

function structuredCopy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
