import { expect, test } from '@playwright/test';

const DIAGNOSTIC_ID = 'swords-wizardry-spell-diagnostics';
const SYSTEM_ID = 'swords-wizardry';
const runtimeEnabled = process.env.SW_FOUNDRY_E2E === '1';

test.describe('Swords & Wizardry v13/v14 release candidate', () => {
  test.skip(!runtimeEnabled, 'Set SW_FOUNDRY_E2E=1 for an authorized disposable-world run.');

  test('real diagnostics, manual HP controls, sheets, HUD, importer, and layout', async ({ page }, testInfo) => {
    const runtime = runtimeConfiguration();
    const evidence = collectEvidence(page);
    await joinWorld(page, runtime.gm);
    await assertDisposableRuntime(page, runtime, true);
    let report;
    try {
      report = await runDiagnostics(page, runtime.player.name);
      expect(report.failed, JSON.stringify(report.tests, null, 2)).toBe(0);
      expect(report.schemaVersion).toBe(2);
      await attachJson(testInfo, 'diagnostic-report.json', report);

      const spellSheet = await openItemSheet(page, report.fixtures.damageSpellUuid);
      const brokenHeaderControls = await spellSheet.locator('.window-header button.header-control.icon')
        .evaluateAll((controls) => controls
          .filter((control) => !getComputedStyle(control).fontFamily.includes('Font Awesome'))
          .map((control) => ({
            action: control.dataset.action,
            fontFamily: getComputedStyle(control).fontFamily
          })));
      expect(brokenHeaderControls).toEqual([]);
      const editEffects = spellSheet.locator('button[data-action="editSpellActions"]');
      await expect(editEffects).toBeVisible();
      await editEffects.focus();
      await page.keyboard.press('Enter');
      const editor = page.locator('form.spell-action-editor');
      await expect(editor).toBeVisible();
      const firstLabel = editor.locator('input[name="actions.0.label"]');
      await firstLabel.fill('Diagnostic draft retained through rerender');
      const addEffect = editor.locator('button[data-action="addAction"]');
      const actionLabels = editor.locator('input[name$=".label"]');
      const actionCount = await actionLabels.count();
      await addEffect.focus();
      await page.keyboard.press('Enter');
      await expect(actionLabels).toHaveCount(actionCount + 1);
      await expect(actionLabels.last()).toBeFocused();
      await expect(firstLabel).toHaveValue('Diagnostic draft retained through rerender');
      await page.setViewportSize({ width: 800, height: 600 });
      const editorLayout = await editor.evaluate((element) => ({
        right: element.getBoundingClientRect().right,
        bottom: element.getBoundingClientRect().bottom,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight
      }));
      expect(editorLayout.right).toBeLessThanOrEqual(editorLayout.viewportWidth);
      expect(editorLayout.bottom).toBeLessThanOrEqual(editorLayout.viewportHeight + 2);
      await page.screenshot({ path: testInfo.outputPath('constrained-spell-editor.png') });
      await closeApplication(page, 'form.spell-action-editor');
      await closeApplication(page, 'form.swords-wizardry.sheet.item');

      await exerciseAbilityRolls(page, report.fixtures.casterUuid, testInfo);
      await exerciseStatRollControls(
        page,
        report.fixtures.casterUuid,
        report.fixtures.targetActorUuid
      );
      await exerciseFeatureCards(page, report.fixtures, testInfo);
      await exerciseItemCards(page, report.fixtures, testInfo);
      await exerciseItemTableLayouts(page, report.fixtures.casterUuid, testInfo);
      await exerciseArmorEquipped(page, report.fixtures, testInfo);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => {
        ui.sidebar?.expand?.();
        ui.chat?.scrollBottom?.();
      });
      const damageCard = messageRoot(
        page, report.fixtures.manualDamageMessageId,
        '[data-spell-message-kind="spell-result"]'
      );
      await expectReducedCardTitle(damageCard);
      const spellCard = messageRoot(
        page, report.fixtures.castMessageId,
        '[data-spell-message-kind="spell-card"]'
      );
      await expectReducedCardTitle(spellCard);
      const targetBefore = await targetHp(page, report.fixtures.targetTokenUuid);
      const damageButton = damageCard.locator('button[data-action="spellApply"][data-mode="fullDamage"]');
      await expect(damageButton).toBeVisible();
      await damageButton.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => targetHp(page, report.fixtures.targetTokenUuid))
        .toBe(targetBefore - 2);
      await expect(damageCard.locator('.spell-result__application-controls')).toHaveCount(0);
      const safeLedger = await page.evaluate((messageId) => {
        const ledger = game.messages.get(messageId).getFlag('swords-wizardry', 'hitPoints');
        const serialized = JSON.stringify(ledger);
        return {
          entries: Object.keys(ledger?.entries ?? {}).length,
          leaksHp: /"(?:oldHP|newHP|hp)"\s*:/u.test(serialized)
        };
      }, report.fixtures.manualDamageMessageId);
      expect(safeLedger).toEqual({ entries: 1, leaksHp: false });

      const healingCard = messageRoot(
        page, report.fixtures.manualHealingMessageId,
        '[data-spell-message-kind="spell-result"]'
      );
      const healingControls = healingCard.locator('button[data-action="spellApply"]');
      await expect(healingControls).toHaveCount(1);
      await expect(healingControls).toHaveAttribute('data-mode', 'healing');
      await healingControls.click();
      await expect.poll(() => targetHp(page, report.fixtures.targetTokenUuid))
        .toBe(targetBefore);

      const weaponCard = messageRoot(
        page, report.fixtures.weaponDamageMessageId,
        '[data-weapon-message-kind="weapon-damage"]'
      );
      const weaponAttackCard = messageRoot(
        page, report.fixtures.weaponAttackMessageId,
        '[data-weapon-message-kind="weapon-attack"]'
      );
      await expectItemHeaderLayout(weaponAttackCard);
      await expectItemHeaderLayout(weaponCard);
      await expectAttackTargetLine(weaponAttackCard, {
        row: '.weapon-card__targets li',
        name: '.weapon-card__target-name',
        outcome: '.weapon-card__target-outcome',
        expectedName: '[SW Fix Diagnostic] Target Token'
      });
      const spellAttackCard = messageRoot(
        page, report.fixtures.spellAttackMessageId,
        '[data-spell-message-kind="spell-result"]'
      );
      await expectReducedCardTitle(spellAttackCard);
      await expectAttackTargetLine(spellAttackCard, {
        row: '.spell-result__targets li',
        name: '.spell-result__target-name',
        outcome: '.spell-result__attack-outcome',
        expectedName: '[SW Fix Diagnostic] Target Token'
      });
      await expect(weaponCard.locator('.damage-target .target-name')).toBeVisible();
      await expect(weaponCard.locator('.damage-buttons button')).toHaveText([
        'Damage', 'Half', 'Double', 'Apply Healing'
      ]);
      const damageTargetLayout = await weaponCard.locator('.damage-target').evaluate((target) => {
        const list = target.closest('ol');
        return {
          listPadding: getComputedStyle(list).paddingInlineStart,
          markerPosition: getComputedStyle(target).listStylePosition,
          targetWithinList: target.getBoundingClientRect().left >= list.getBoundingClientRect().left
        };
      });
      expect(damageTargetLayout).toEqual({
        listPadding: '0px',
        markerPosition: 'inside',
        targetWithinList: true
      });
      await page.screenshot({ path: testInfo.outputPath('weapon-card-layout.png') });
      await weaponCard.locator('button[data-mode="fullDamage"]').click();
      await expect.poll(() => targetHp(page, report.fixtures.targetTokenUuid))
        .toBe(targetBefore - 2);

      const legacyMessageId = await page.evaluate(async () => {
        const message = await ChatMessage.create({
          content: '<article class="swords-wizardry spell-card" data-spell-message-kind="spell-result"><div class="spell-result__application-controls"><button type="button" data-action="spellApply">Apply</button></div></article>',
          flags: { 'swords-wizardry': { spell: { schemaVersion: 1, messageKind: 'spell-result' } } }
        });
        await message.setFlag('swords-wizardry-spell-diagnostics', 'fixture', true);
        return message.id;
      });
      const legacyCard = messageRoot(page, legacyMessageId, '[data-spell-message-kind]');
      await expect(legacyCard.locator('[data-action="spellApply"]')).toHaveCount(0);
      await expect(legacyCard.locator('.spell-card__legacy-warning')).toContainText('display-only');

      await exerciseImporter(page);
      await exerciseCharacterCreator(page, runtime.gm.name);
      await page.setViewportSize({ width: 800, height: 600 });
      await exerciseHud(page, report.fixtures, testInfo);

      await page.setViewportSize({ width: 1440, height: 900 });
      const themed = await damageCard.evaluate((element) => {
        const heading = element.querySelector('h3');
        element.style.color = 'rgb(230, 231, 232)';
        return {
          cardColor: getComputedStyle(element).color,
          headingColor: getComputedStyle(heading).color,
          textShadow: getComputedStyle(heading).textShadow,
          fontFamily: getComputedStyle(element).fontFamily
        };
      });
      expect(themed.headingColor).toBe(themed.cardColor);
      expect(themed.textShadow).toBe('none');
      expect(themed.fontFamily).toContain('Libre Baskerville');
      expect(criticalEvidence(evidence)).toEqual([]);
    } finally {
      await cleanupDiagnostics(page);
      await attachJson(testInfo, 'runtime-events.json', evidence);
    }
  });

  test('player requests remain GM-authoritative in manual and automatic modes', async ({ browser }, testInfo) => {
    const runtime = runtimeConfiguration();
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    const gmEvidence = collectEvidence(gmPage);
    const playerEvidence = collectEvidence(playerPage);
    let originalSetting;
    try {
      await joinWorld(gmPage, runtime.gm);
      await joinWorld(playerPage, runtime.player);
      const report = await runDiagnostics(gmPage, runtime.player.name);
      expect(report.failed, JSON.stringify(report.tests, null, 2)).toBe(0);
      originalSetting = await gmPage.evaluate(() => game.settings.get('swords-wizardry', 'dmAppliesDamage'));
      await gmPage.evaluate(() => game.settings.set('swords-wizardry', 'dmAppliesDamage', true));
      await expect.poll(() => playerPage.evaluate(() => game.settings.get('swords-wizardry', 'dmAppliesDamage'))).toBe(true);

      const manual = await playerSpellResult(playerPage, {
        spellUuid: report.fixtures.damageSpellUuid,
        targetUuid: report.fixtures.targetTokenUuid,
        actionId: 'diagnostic-damage'
      });
      expect(manual.status).toBe('success');
      await gmPage.evaluate(() => {
        ui.sidebar?.expand?.();
        ui.chat?.scrollBottom?.();
      });
      await playerPage.evaluate(() => {
        ui.sidebar?.expand?.();
        ui.chat?.scrollBottom?.();
      });
      const gmManual = messageRoot(gmPage, manual.messageId, '[data-spell-message-kind="spell-result"]');
      const playerManual = messageRoot(playerPage, manual.messageId, '[data-spell-message-kind="spell-result"]');
      await expect(gmManual.locator('[data-action="spellApply"]')).toHaveCount(3);
      await expect(playerManual.locator('[data-action="spellApply"]')).toHaveCount(0);
      const beforeManual = await targetHp(gmPage, report.fixtures.targetTokenUuid);
      await gmManual.locator('button[data-mode="fullDamage"]').click();
      await expect.poll(() => targetHp(playerPage, report.fixtures.targetTokenUuid))
        .toBe(beforeManual - 2);

      await gmPage.evaluate(() => game.settings.set('swords-wizardry', 'dmAppliesDamage', false));
      await expect.poll(() => playerPage.evaluate(() => game.settings.get('swords-wizardry', 'dmAppliesDamage'))).toBe(false);
      const beforeAuto = await targetHp(gmPage, report.fixtures.targetTokenUuid);
      const automaticDamage = await playerSpellResult(playerPage, {
        spellUuid: report.fixtures.damageSpellUuid,
        targetUuid: report.fixtures.targetTokenUuid,
        actionId: 'diagnostic-damage'
      });
      expect(automaticDamage.status).toBe('success');
      await expect.poll(() => targetHp(gmPage, report.fixtures.targetTokenUuid))
        .toBe(beforeAuto - 2);
      const automaticHealing = await playerSpellResult(playerPage, {
        spellUuid: report.fixtures.healingSpellUuid,
        targetUuid: report.fixtures.targetTokenUuid,
        actionId: 'diagnostic-healing'
      });
      expect(automaticHealing.status).toBe('success');
      await expect.poll(() => targetHp(gmPage, report.fixtures.targetTokenUuid))
        .toBe(beforeAuto + 1);

      const weaponBefore = await targetHp(gmPage, report.fixtures.targetTokenUuid);
      const weapon = await playerPage.evaluate(async ({ weaponUuid, targetUuid }) => {
        const attack = await game.swordswizardry.weapons.attack(weaponUuid, {
          targetUuids: [targetUuid], rollMode: 'publicroll'
        });
        if (attack.status !== 'success') return attack;
        const damage = await game.swordswizardry.weapons.damage(attack.messageUuid);
        return { ...damage, attackMessageUuid: attack.messageUuid };
      }, { weaponUuid: report.fixtures.weaponUuid, targetUuid: report.fixtures.targetTokenUuid });
      expect(weapon.status).toBe('success');
      await expect.poll(() => targetHp(gmPage, report.fixtures.targetTokenUuid))
        .toBe(weaponBefore - 2);

      const forgedId = await playerPage.evaluate(async (targetUuid) => {
        const message = await ChatMessage.create({
          content: '<article class="swords-wizardry spell-card" data-spell-message-kind="spell-result"><div class="spell-result__application-controls"><button type="button" data-action="spellApply">Apply</button></div></article>',
          flags: {
            'swords-wizardry': {
              spell: { schemaVersion: 2, messageKind: 'spell-result', targetUuids: [targetUuid] }
            }
          }
        });
        await message.setFlag('swords-wizardry-spell-diagnostics', 'fixture', true);
        return message.id;
      }, report.fixtures.targetTokenUuid);
      const forged = messageRoot(gmPage, forgedId, '[data-spell-message-kind]');
      await expect(forged.locator('[data-action="spellApply"]')).toHaveCount(0);
      await expect(forged.locator('.spell-card__legacy-warning')).toBeVisible();
      expect(criticalEvidence(gmEvidence)).toEqual([]);
      expect(criticalEvidence(playerEvidence)).toEqual([]);
    } finally {
      if (typeof originalSetting === 'boolean' && !gmPage.isClosed()) {
        await gmPage.evaluate((value) => game.settings.set('swords-wizardry', 'dmAppliesDamage', value), originalSetting).catch(() => {});
      }
      await cleanupDiagnostics(gmPage);
      await attachJson(testInfo, 'gm-runtime-events.json', gmEvidence);
      await attachJson(testInfo, 'player-runtime-events.json', playerEvidence);
      await gmContext.close().catch(() => {});
      await playerContext.close().catch(() => {});
    }
  });

  test('ordinary-player permissions, trusted creation, and active-GM failover', async ({ browser }, testInfo) => {
    const runtime = runtimeConfiguration();
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const creatorContext = await browser.newContext();
    const secondGmContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    const creatorPage = await creatorContext.newPage();
    const secondGmPage = await secondGmContext.newPage();
    let cleanupPage = gmPage;
    let originalPermissions;
    try {
      await joinWorld(gmPage, runtime.gm);
      const report = await runDiagnostics(gmPage, runtime.player.name);
      expect(report.failed, JSON.stringify(report.tests, null, 2)).toBe(0);
      originalPermissions = await gmPage.evaluate(async () => {
        const permissions = foundry.utils.deepClone(game.settings.get('core', 'permissions'));
        await game.settings.set('core', 'permissions', {
          ...permissions,
          ACTOR_CREATE: [
            CONST.USER_ROLES.TRUSTED,
            CONST.USER_ROLES.ASSISTANT,
            CONST.USER_ROLES.GAMEMASTER
          ]
        });
        return permissions;
      });
      await joinWorld(playerPage, runtime.player);
      await joinWorld(creatorPage, runtime.creator);
      expect(await playerPage.evaluate(() => game.user.can('ACTOR_CREATE'))).toBe(false);
      expect(await creatorPage.evaluate(() => game.user.can('ACTOR_CREATE'))).toBe(true);
      await showActorDirectory(playerPage);
      await expect(playerPage.locator('button.character-creator')).toHaveCount(0);
      await exerciseCharacterCreator(creatorPage, runtime.creator.name);

      await joinWorld(secondGmPage, runtime.secondGm);
      const firstIsActive = await gmPage.evaluate(() => game.user.isActiveGM === true);
      if (firstIsActive) {
        await gmContext.close();
        cleanupPage = secondGmPage;
      } else {
        await secondGmContext.close();
        cleanupPage = gmPage;
      }
      await expect.poll(() => cleanupPage.evaluate(() => game.user.isActiveGM === true), {
        timeout: 20_000
      }).toBe(true);
      const failover = await playerSpellResult(playerPage, {
        spellUuid: report.fixtures.damageSpellUuid,
        targetUuid: report.fixtures.targetTokenUuid,
        actionId: 'diagnostic-damage'
      });
      expect(failover.status).toBe('success');
      const authority = await cleanupPage.evaluate((messageId) => {
        const message = game.messages.get(messageId);
        return { authorId: message.author?.id, activeGmId: game.users.activeGM?.id };
      }, failover.messageId);
      expect(authority.authorId).toBe(authority.activeGmId);
      await attachJson(testInfo, 'failover-result.json', authority);
    } finally {
      if (originalPermissions && !cleanupPage.isClosed()) {
        await cleanupPage.evaluate(
          (permissions) => game.settings.set('core', 'permissions', permissions),
          originalPermissions
        ).catch(() => {});
      }
      await cleanupDiagnostics(cleanupPage);
      if (!gmPage.isClosed()) await gmContext.close();
      if (!playerPage.isClosed()) await playerContext.close();
      if (!creatorPage.isClosed()) await creatorContext.close();
      if (!secondGmPage.isClosed()) await secondGmContext.close();
    }
  });
});

function runtimeConfiguration() {
  const configuration = {
    worldId: required('SW_FOUNDRY_WORLD_ID'),
    disposable: required('SW_FOUNDRY_DISPOSABLE_WORLD'),
    gm: userConfiguration('GM'),
    player: userConfiguration('PLAYER'),
    creator: userConfiguration('CREATOR'),
    secondGm: userConfiguration('SECOND_GM')
  };
  if (configuration.disposable !== 'YES') throw new Error('Disposable-world confirmation is required.');
  return configuration;
}

function userConfiguration(role) {
  return {
    name: required(`SW_FOUNDRY_${role}_NAME`),
    password: process.env[`SW_FOUNDRY_${role}_PASSWORD`] ?? ''
  };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function joinWorld(page, user) {
  await page.goto('.');
  if (!await foundryReady(page)) {
    const identity = page.locator('select[name="userid"], input[name="username"]').first();
    await expect(identity).toBeVisible();
    const select = page.locator('select[name="userid"]');
    if (await select.isVisible()) await select.selectOption({ label: user.name });
    else await page.locator('input[name="username"]').fill(user.name);
    const password = page.locator('input[name="password"]');
    if (await password.count()) await password.fill(user.password);
    await page.locator('button[name="join"], button[type="submit"]').first().click();
    await page.waitForFunction(() => globalThis.game?.ready === true);
  }
  const userConfig = page.locator('.user-config').last();
  if (await userConfig.isVisible().catch(() => false)) {
    const submit = userConfig.locator('button[type="submit"]').last();
    if (await submit.isVisible().catch(() => false)) await submit.click();
    else await userConfig.locator('.window-header [data-action="close"]').click({ force: true });
    await expect(userConfig).not.toBeVisible();
  }
}

async function foundryReady(page) {
  return page.evaluate(() => globalThis.game?.ready === true).catch(() => false);
}

async function assertDisposableRuntime(page, runtime, expectGm) {
  const actual = await page.evaluate((diagnosticId) => ({
    worldId: game.world.id,
    systemId: game.system.id,
    diagnostic: game.modules.get(diagnosticId)?.active,
    isGM: game.user.isGM
  }), DIAGNOSTIC_ID);
  expect(actual).toEqual({
    worldId: runtime.worldId,
    systemId: SYSTEM_ID,
    diagnostic: true,
    isGM: expectGm
  });
}

async function runDiagnostics(page, ownerName) {
  return page.evaluate(async ({ diagnosticId, ownerName }) => {
    const owner = game.users.getName(ownerName);
    return game.modules.get(diagnosticId).api.run({
      retainFixtures: true,
      ownerUserId: owner.id
    });
  }, { diagnosticId: DIAGNOSTIC_ID, ownerName });
}

async function playerSpellResult(page, { spellUuid, targetUuid, actionId }) {
  return page.evaluate(async ({ spellUuid, targetUuid, actionId }) => {
    const spell = await fromUuid(spellUuid);
    const card = await game.swordswizardry.spells.post(spell, { targetUuids: [targetUuid] });
    if (card.status !== 'success') return { status: card.status, code: card.code };
    const result = await game.swordswizardry.spells.invoke(card.message, actionId, {
      targetUuids: [targetUuid], rollMode: 'publicroll'
    });
    return {
      status: result.status,
      code: result.code ?? null,
      cardId: card.message.id,
      messageId: result.messageUuid?.split('.').at(-1) ?? null
    };
  }, { spellUuid, targetUuid, actionId });
}

async function openItemSheet(page, uuid) {
  await page.evaluate(async (uuid) => (await fromUuid(uuid)).sheet.render(true), uuid);
  const sheet = page.locator('form.swords-wizardry.sheet.item').last();
  await expect(sheet).toBeVisible();
  return sheet;
}

async function exerciseAbilityRolls(page, actorUuid, testInfo) {
  await page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    await actor.update({ 'system.abilities.str.value': 25 });
    actor.sheet.render(true);
  }, actorUuid);
  const sheet = page.locator('form.swords-wizardry.sheet.actor').last();
  await expect(sheet).toBeVisible();
  const control = sheet.locator('.ability-roll-control[data-ability="str"]');
  await expect(control).toBeVisible();
  await expect(control.locator('i.fa-dice-d20 + span')).toHaveText('Strength');
  const hitArea = await control.evaluate((button) => {
    const icon = button.querySelector('i').getBoundingClientRect();
    const label = button.querySelector('span').getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return {
      iconBeforeLabel: icon.right <= label.left,
      containsIcon: icon.left >= bounds.left && icon.right <= bounds.right,
      containsLabel: label.left >= bounds.left && label.right <= bounds.right
    };
  });
  expect(hitArea).toEqual({ iconBeforeLabel: true, containsIcon: true, containsLabel: true });

  const successMessageId = await rollAbilityFromSheet(page, control, 'i');
  const successCard = messageRoot(page, successMessageId, '.ability-roll-card');
  await expect(successCard.locator('.threshold-roll-card__outcome')).toHaveClass(/is-success/);
  await expectThresholdResultLayout(successCard);
  await expectThresholdOutcomeStyle(successCard.locator('.threshold-roll-card__outcome'), 'Success');

  await page.evaluate(async (uuid) => {
    await (await fromUuid(uuid)).update({ 'system.abilities.str.value': 0 });
  }, actorUuid);
  await expect(sheet.locator('input[name="system.abilities.str.value"]')).toHaveValue('0');
  const failureMessageId = await rollAbilityFromSheet(page, control, 'span');
  const failureCard = messageRoot(page, failureMessageId, '.ability-roll-card');
  await expect(failureCard.locator('.threshold-roll-card__outcome')).toHaveClass(/is-failure/);
  await expectThresholdResultLayout(failureCard);
  await expectThresholdOutcomeStyle(failureCard.locator('.threshold-roll-card__outcome'), 'Failure');
  await page.screenshot({ path: testInfo.outputPath('attribute-roll-results.png') });
  await closeApplication(page, 'form.swords-wizardry.sheet.actor');
}

async function rollAbilityFromSheet(page, control, clickPart) {
  const messageId = await triggerSheetRoll(page, control, clickPart);
  await page.evaluate(() => {
    ui.sidebar?.changeTab?.('chat', 'primary');
    ui.sidebar?.expand?.();
    ui.chat?.scrollBottom?.();
  });
  return messageId;
}

async function expectThresholdOutcomeStyle(outcome, text) {
  await expect(outcome).toHaveText(new RegExp(text, 'i'));
  const styles = await outcome.evaluate((element) => ({
    color: getComputedStyle(element).color,
    inheritedColor: getComputedStyle(element.parentElement).color,
    fontWeight: Number(getComputedStyle(element).fontWeight),
    textTransform: getComputedStyle(element).textTransform
  }));
  expect(styles.color).not.toBe(styles.inheritedColor);
  expect(styles.fontWeight).toBeGreaterThanOrEqual(700);
  expect(styles.textTransform).toBe('uppercase');
}

async function exerciseStatRollControls(page, characterUuid, npcUuid) {
  const controls = [
    {
      actorUuid: characterUuid,
      action: 'saveRoll',
      text: 'Save',
      clickPart: 'span'
    },
    {
      actorUuid: npcUuid,
      action: 'saveRoll',
      text: 'Saving Throw',
      clickPart: 'i'
    },
    {
      actorUuid: npcUuid,
      action: 'moraleRoll',
      text: 'Morale',
      clickPart: 'span'
    }
  ];

  for (const definition of controls) {
    await page.evaluate(async (uuid) => (await fromUuid(uuid)).sheet.render(true), definition.actorUuid);
    const sheet = page.locator('form.swords-wizardry.sheet.actor').last();
    await expect(sheet).toBeVisible();
    const control = sheet.locator(`.stat-roll-control[data-action="${definition.action}"]`);
    await expect(control).toBeVisible();
    await expect(control.locator('span')).toHaveText(definition.text);
    const layout = await control.evaluate((button) => {
      const label = button.querySelector('span').getBoundingClientRect();
      const icon = button.querySelector('i').getBoundingClientRect();
      return {
        iconAfterLabel: label.right <= icon.left,
        sameLine: Math.abs((label.top + label.bottom) - (icon.top + icon.bottom)) <= 2,
        noOverflow: button.scrollWidth <= button.clientWidth + 1,
        whiteSpace: getComputedStyle(button).whiteSpace,
        labelPointerEvents: getComputedStyle(button.querySelector('span')).pointerEvents,
        iconPointerEvents: getComputedStyle(button.querySelector('i')).pointerEvents
      };
    });
    expect(layout).toEqual({
      iconAfterLabel: true,
      sameLine: true,
      noOverflow: true,
      whiteSpace: 'nowrap',
      labelPointerEvents: 'none',
      iconPointerEvents: 'none'
    });
    const messageId = await triggerSheetRoll(page, control, definition.clickPart);
    await page.evaluate(() => {
      ui.sidebar?.changeTab?.('chat', 'primary');
      ui.sidebar?.expand?.();
      ui.chat?.scrollBottom?.();
    });
    const card = messageRoot(page, messageId, '.threshold-roll-card');
    await expectThresholdResultLayout(card);
    await expectThresholdOutcomeStyle(
      card.locator('.threshold-roll-card__outcome'),
      await card.locator('.threshold-roll-card__outcome').innerText()
    );
    await closeApplication(page, 'form.swords-wizardry.sheet.actor');
  }
}

async function exerciseFeatureCards(page, fixtures, testInfo) {
  await page.evaluate(() => {
    ui.sidebar?.changeTab?.('chat', 'primary');
    ui.sidebar?.expand?.();
    ui.chat?.scrollBottom?.();
  });

  const descriptionCard = messageRoot(page, fixtures.featureMessageId, '.feature-card');
  await expectItemHeaderLayout(descriptionCard);
  await expect(descriptionCard.locator('.feature-card__header h3'))
    .toHaveText('[SW Fix Diagnostic] Blank Feature');
  await expect(descriptionCard.locator('.feature-card__description'))
    .toContainText('Diagnostic feature description.');
  await expect(descriptionCard.locator('.inline-result')).toHaveCount(0);
  await expect(descriptionCard.locator('.threshold-roll-card__result')).toHaveCount(0);

  const thresholdCard = messageRoot(
    page, fixtures.thresholdFeatureMessageId, '.feature-card'
  );
  await expectItemHeaderLayout(thresholdCard);
  await expect(thresholdCard.locator('.feature-card__header h3'))
    .toHaveText('[SW Fix Diagnostic] Threshold Feature');
  await expect(thresholdCard.locator('.feature-card__description'))
    .toContainText('Diagnostic rollable feature description.');
  await expect(thresholdCard.locator('.inline-result')).toBeVisible();
  await expectThresholdResultLayout(thresholdCard);
  const outcome = thresholdCard.locator('.threshold-roll-card__outcome');
  await expect(outcome).toHaveText(/Success|Failure/);
  await expectThresholdOutcomeStyle(outcome, await outcome.innerText());
  await thresholdCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('feature-card-layout.png') });
}

async function exerciseItemCards(page, fixtures, testInfo) {
  const cards = [
    {
      messageId: fixtures.armorMessageId,
      title: '[SW Fix Diagnostic] Test Armor',
      description: 'Diagnostic armor description.'
    },
    {
      messageId: fixtures.itemMessageId,
      title: '[SW Fix Diagnostic] Test Item',
      description: 'Diagnostic item description.'
    }
  ];

  for (const definition of cards) {
    const card = messageRoot(page, definition.messageId, '.item-card');
    await expectItemHeaderLayout(card);
    await expect(card.locator('.item-card__header img')).toBeVisible();
    await expect(card.locator('.item-card__header h3')).toHaveText(definition.title);
    await expect(card.locator('.item-card__description')).toContainText(definition.description);
  }
  const itemCard = messageRoot(page, fixtures.itemMessageId, '.item-card');
  await itemCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('armor-item-card-layout.png') });
}

async function exerciseItemTableLayouts(page, actorUuid, testInfo) {
  await page.evaluate(async (uuid) => (await fromUuid(uuid)).sheet.render(true), actorUuid);
  const actorSheet = page.locator('form.swords-wizardry.sheet.actor').last();
  await expect(actorSheet).toBeVisible();
  await actorSheet.locator('a[data-action="tab"][data-tab="weapons"]').click();

  const combatTables = actorSheet.locator(
    'section[data-tab="weapons"] > ol.columnar-items-list'
  );
  await expect(combatTables).toHaveCount(2);
  for (const table of await combatTables.all()) await expectAlignedTableSeparators(table);

  await actorSheet.locator('a[data-action="tab"][data-tab="items"]').click();
  const equipmentTable = actorSheet.locator(
    'section[data-tab="items"] > ol.columnar-items-list'
  );
  await expect(equipmentTable).toHaveCount(1);
  await expectAlignedTableSeparators(equipmentTable);

  const quantity = equipmentTable.locator('.item:not(.items-header) .item-quantity').first();
  const quantityLayout = await quantity.evaluate((cell) => {
    const decrement = cell.querySelector('[data-action="itemDecrement"]').getBoundingClientRect();
    const value = cell.querySelector('.item-quantity__value').getBoundingClientRect();
    const increment = cell.querySelector('[data-action="itemIncrement"]').getBoundingClientRect();
    const center = (bounds) => (bounds.top + bounds.bottom) / 2;
    return {
      display: getComputedStyle(cell).display,
      sameLine: Math.max(center(decrement), center(value), center(increment))
        - Math.min(center(decrement), center(value), center(increment)) <= 1,
      correctOrder: decrement.right <= value.left && value.right <= increment.left,
      noOverflow: cell.scrollWidth <= cell.clientWidth + 1
    };
  });
  expect(quantityLayout).toEqual({
    display: 'flex',
    sameLine: true,
    correctOrder: true,
    noOverflow: true
  });
  await equipmentTable.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('equipment-table-layout.png') });
  await closeApplication(page, 'form.swords-wizardry.sheet.actor');
}

async function expectAlignedTableSeparators(table) {
  const layout = await table.evaluate((list) => {
    const header = list.querySelector('.items-header');
    const row = list.querySelector('.item:not(.items-header)');
    const inspect = (element) => [...element.children].map((cell) => {
      const bounds = cell.getBoundingClientRect();
      const style = getComputedStyle(cell);
      return {
        left: bounds.left,
        height: bounds.height,
        borderLeft: style.borderLeftWidth,
        borderRight: style.borderRightWidth
      };
    });
    return {
      header: inspect(header),
      row: inspect(row),
      rowSpacing: {
        paddingTop: getComputedStyle(row).paddingTop,
        paddingBottom: getComputedStyle(row).paddingBottom,
        marginTop: getComputedStyle(row).marginTop,
        marginBottom: getComputedStyle(row).marginBottom,
        nameOffset: getComputedStyle(row.querySelector('.item-name-span')).marginTop,
        controlOffset: getComputedStyle(row.querySelector('.item-controls button')).marginTop
      }
    };
  });
  for (const cells of [layout.header, layout.row]) {
    expect(cells[0].borderLeft).toBe('0px');
    expect(cells.every((cell) => cell.borderRight === '0px')).toBe(true);
    expect(cells.slice(1).every((cell) => cell.borderLeft === '1px')).toBe(true);
  }
  expect(layout.header.map((cell) => Math.round(cell.left)))
    .toEqual(layout.row.map((cell) => Math.round(cell.left)));
  expect(
    new Set(layout.header.map((cell) => Math.round(cell.height))).size,
    JSON.stringify(layout.header)
  ).toBe(1);
  expect(
    new Set(layout.row.map((cell) => Math.round(cell.height))).size,
    JSON.stringify(layout.row)
  ).toBe(1);
  expect(layout.rowSpacing).toEqual({
    paddingTop: '6px',
    paddingBottom: '6px',
    marginTop: '0px',
    marginBottom: '0px',
    nameOffset: '0px',
    controlOffset: '0px'
  });
}

async function exerciseArmorEquipped(page, fixtures, testInfo) {
  const itemSheet = await openItemSheet(page, fixtures.armorUuid);
  await expect(itemSheet.locator('input[name="system.equipped"]')).toBeChecked();
  await closeApplication(page, 'form.swords-wizardry.sheet.item');

  await exerciseActorArmorToggle(page, {
    actorUuid: fixtures.casterUuid,
    armorUuid: fixtures.armorUuid,
    screenshotPath: testInfo.outputPath('armor-equipped-toggle.png')
  });
  await exerciseActorArmorToggle(page, {
    actorUuid: fixtures.targetActorUuid,
    armorUuid: fixtures.targetArmorUuid
  });
}

async function exerciseActorArmorToggle(page, { actorUuid, armorUuid, screenshotPath }) {
  const initial = await page.evaluate(async ({ actorUuid, armorUuid }) => {
    const actor = await fromUuid(actorUuid);
    const armor = await fromUuid(armorUuid);
    actor.sheet.render(true);
    return {
      ac: actor.system.ac.value,
      aac: actor.system.aac.value,
      effect: armor.system.effectOnAC,
      equipped: armor.system.equipped
    };
  }, { actorUuid, armorUuid });
  expect(initial.equipped).toBe(true);

  const actorSheet = page.locator('form.swords-wizardry.sheet.actor').last();
  await expect(actorSheet).toBeVisible();
  await actorSheet.locator('a[data-action="tab"][data-tab="weapons"]').click();
  const armorId = armorUuid.split('.').at(-1);
  const armorRow = actorSheet.locator(`[data-item-id="${armorId}"]`);
  const equipped = armorRow.locator('input[data-action="armorEquipped"]');
  await expect(equipped).toBeChecked();
  await equipped.click();
  await expect.poll(() => page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    return { ac: actor.system.ac.value, aac: actor.system.aac.value };
  }, actorUuid)).toEqual({
    ac: initial.ac + initial.effect,
    aac: initial.aac - initial.effect
  });
  await expect(equipped).not.toBeChecked();

  await equipped.click();
  await expect.poll(() => page.evaluate(async (uuid) => {
    const actor = await fromUuid(uuid);
    return { ac: actor.system.ac.value, aac: actor.system.aac.value };
  }, actorUuid)).toEqual({ ac: initial.ac, aac: initial.aac });
  await expect(equipped).toBeChecked();
  if (screenshotPath) {
    await armorRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath });
  }
  await closeApplication(page, 'form.swords-wizardry.sheet.actor');
}

async function expectThresholdResultLayout(card) {
  await expectReducedCardTitle(card);
  const layout = await card.locator('.threshold-roll-card__result').evaluate((row) => {
    const target = row.querySelector('.threshold-roll-card__target').getBoundingClientRect();
    const outcome = row.querySelector('.threshold-roll-card__outcome').getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    return {
      display: getComputedStyle(row).display,
      sameLine: Math.abs((target.top + target.bottom) - (outcome.top + outcome.bottom)) <= 2,
      targetFirst: target.right <= outcome.left,
      outcomeRightAligned: Math.abs(outcome.right - bounds.right) <= 1
    };
  });
  expect(layout).toEqual({
    display: 'flex',
    sameLine: true,
    targetFirst: true,
    outcomeRightAligned: true
  });
}

async function expectItemHeaderLayout(card) {
  await expectReducedCardTitle(card);
  const layout = await card.locator('.item-card__header').evaluate((header) => {
    const image = header.querySelector('img').getBoundingClientRect();
    const heading = header.querySelector('h3').getBoundingClientRect();
    return {
      display: getComputedStyle(header).display,
      headingAfterIcon: image.right <= heading.left,
      verticallyAligned: image.top < heading.bottom && heading.top < image.bottom,
      headingMargin: getComputedStyle(header.querySelector('h3')).margin
    };
  });
  expect(layout).toEqual({
    display: 'flex',
    headingAfterIcon: true,
    verticallyAligned: true,
    headingMargin: '0px'
  });
}

async function expectReducedCardTitle(card) {
  const title = card.locator('.chat-card__title');
  await expect(title).toBeVisible();
  const fontSize = await title.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(fontSize).toBeLessThanOrEqual(16.5);
}

async function expectAttackTargetLine(card, definition) {
  const row = card.locator(definition.row).first();
  await expect(row).toBeVisible();
  const layout = await row.evaluate((element, selectors) => {
    const name = element.querySelector(selectors.name);
    const outcome = element.querySelector(selectors.outcome);
    return {
      text: element.innerText.trim().replace(/\s+/gu, ' '),
      name: name.textContent.trim(),
      outcome: outcome.textContent.trim(),
      nameWeight: Number(getComputedStyle(name).fontWeight),
      marker: getComputedStyle(element).listStyleType
    };
  }, definition);
  expect(layout).toEqual({
    text: `${definition.expectedName}: Hit!`,
    name: definition.expectedName,
    outcome: 'Hit!',
    nameWeight: 700,
    marker: 'decimal'
  });
}

async function triggerSheetRoll(page, control, clickPart) {
  const existingIds = await page.evaluate(() => game.messages.map((message) => message.id));
  const position = await control.evaluate((button, selector) => {
    const bounds = button.getBoundingClientRect();
    const target = button.querySelector(selector).getBoundingClientRect();
    return {
      x: ((target.left + target.right) / 2) - bounds.left,
      y: ((target.top + target.bottom) / 2) - bounds.top
    };
  }, clickPart);
  // Keep Foundry's permanent headless-browser warnings visible as evidence,
  // but prevent that harness-only layer from swallowing the real button click.
  await page.locator('#notifications').evaluate((element) => {
    for (const notificationElement of [element, ...element.querySelectorAll('*')]) {
      notificationElement.style.setProperty('pointer-events', 'none', 'important');
    }
  });
  await control.click({ position, timeout: 5_000 });
  await page.waitForFunction(
    (ids) => game.messages.some((message) => !ids.includes(message.id)),
    existingIds
  );
  return page.evaluate(async ({ ids, diagnosticId }) => {
    const message = game.messages.find((candidate) => !ids.includes(candidate.id));
    await message.setFlag(diagnosticId, 'fixture', true);
    return message.id;
  }, { ids: existingIds, diagnosticId: DIAGNOSTIC_ID });
}

async function closeApplication(page, selector) {
  const application = page.locator(selector).last();
  if (!await application.isVisible().catch(() => false)) return;
  await application.locator('.window-header [data-action="close"]').first().click();
  await expect(application).not.toBeVisible();
}

function messageRoot(page, messageId, childSelector) {
  return page.locator(`#sidebar #chat [data-message-id="${messageId}"] ${childSelector}`);
}

async function targetHp(page, targetUuid) {
  return page.evaluate(async (uuid) => (await fromUuid(uuid)).actor.system.hp.value, targetUuid);
}

async function showActorDirectory(page) {
  await page.evaluate(() => {
    ui.sidebar?.changeTab?.('actors', 'primary');
    ui.sidebar?.expand?.();
  });
  await expect(page.locator('#actors.actors-sidebar')).toBeVisible();
}

async function exerciseImporter(page) {
  await showActorDirectory(page);
  const button = page.locator('button.import-manager');
  await expect(button).toBeVisible();
  await button.click();
  const form = page.locator('form#swords-wizardry-import-sheet');
  await expect(form).toBeVisible();
  await form.locator('textarea[name="importText"]').fill(
    '[SW Fix Diagnostic] Imported Goblin: HD 1d6; AC 6 [13]; Attack Spear (1d6); Move 9; Save 18; Morale 7; Alignment chaotic; CL/XP 1/15'
  );
  await form.locator('button[type="submit"]').click();
  await expect(form).not.toBeVisible();
  expect(await page.evaluate(() => game.actors.getName('[SW Fix Diagnostic] Imported Goblin')?.items.size)).toBe(1);
  await closeApplication(page, 'form.swords-wizardry.sheet.actor');
}

async function exerciseCharacterCreator(page, userName) {
  await showActorDirectory(page);
  const button = page.locator('button.character-creator');
  await expect(button).toBeVisible();
  await button.click();
  const form = page.locator('form#swords-wizardry-character-creator');
  await expect(form).toBeVisible();
  const name = `[SW Fix Diagnostic] Character ${userName}`;
  await form.locator('input[name="name"]').fill(name);
  await form.locator('button[type="submit"]').click();
  await expect(form).not.toBeVisible();
  const ownership = await page.evaluate((name) => {
    const actor = game.actors.getName(name);
    return { default: actor.ownership.default, creator: actor.ownership[game.user.id] };
  }, name);
  expect(ownership.default).toBe(0);
  expect(ownership.creator).toBe(3);
  await closeApplication(page, 'form.swords-wizardry.sheet.actor');
}

async function exerciseHud(page, fixtures, testInfo) {
  const expectedTitles = await page.evaluate(async ({ casterTokenUuid, targetTokenUuid }) => {
    const caster = await fromUuid(casterTokenUuid);
    const target = await fromUuid(targetTokenUuid);
    return {
      caster: caster.actor.name,
      target: target.actor.name
    };
  }, fixtures);
  await page.evaluate(async ({ sceneUuid, casterTokenUuid, targetTokenUuid }) => {
    const scene = await fromUuid(sceneUuid);
    if (!scene.active) await scene.activate();
    if (!canvas.ready || canvas.scene?.id !== scene.id) {
      await new Promise((resolve) => Hooks.once('canvasReady', resolve));
    }
    for (const uuid of [casterTokenUuid, targetTokenUuid]) {
      const token = await fromUuid(uuid);
      token.object?.control({ releaseOthers: false });
    }
  }, fixtures);
  await expect(page.locator('.swords-wizardry-combat-hud')).toHaveCount(2);
  const layouts = await page.locator('.swords-wizardry-combat-hud').evaluateAll((elements) => (
    elements.map((element) => {
      const frame = element.closest('.application');
      const rect = frame.getBoundingClientRect();
      const buttons = [...element.querySelectorAll('.combat-hud-list button')];
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        title: frame.querySelector('.window-title')?.textContent?.trim(),
        icon: frame.querySelector('.window-icon')?.className,
        fontSize: getComputedStyle(element.querySelector('.combat-hud')).fontSize,
        labels: buttons.map((button) => button.textContent.trim()),
        controls: buttons.map((button) => {
          const style = getComputedStyle(button);
          const buttonBounds = button.getBoundingClientRect();
          const imageBounds = button.querySelector('img').getBoundingClientRect();
          const label = button.querySelector('span');
          return {
            borderWidth: style.borderWidth,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            height: buttonBounds.height,
            justifyContent: style.justifyContent,
            contentLeftInset: Math.round(imageBounds.left - buttonBounds.left),
            labelFits: label.scrollWidth <= label.clientWidth + 1
          };
        })
      };
    })
  ));
  for (const rect of layouts) {
    expect(rect.left).toBe(15);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(800);
    expect(rect.bottom).toBeLessThanOrEqual(600);
    expect(rect.width).toBeGreaterThanOrEqual(200);
    expect(rect.width).toBeLessThanOrEqual(350);
    expect(Math.abs(rect.top - ((600 - rect.height) / 2))).toBeLessThanOrEqual(1);
    expect(rect.icon).toContain('fa-gear');
    expect(rect.fontSize).toBe('14px');
    expect(rect.controls.every((control) => (
      control.borderWidth === '0px'
      && control.backgroundColor === 'rgba(0, 0, 0, 0)'
      && control.fontSize === '12px'
      && control.height <= 28
      && control.justifyContent === 'flex-start'
      && control.contentLeftInset === 0
      && control.labelFits
    ))).toBe(true);
  }
  expect(layouts.map((layout) => layout.title).sort())
    .toEqual([expectedTitles.caster, expectedTitles.target].sort());
  const casterHud = layouts.find((layout) => layout.title === expectedTitles.caster);
  expect(casterHud.width).toBeGreaterThan(200);
  expect(casterHud.labels).toContain('[SW Fix Diagnostic] Sure Strike');
  expect(casterHud.labels).toContain('[SW Fix Diagnostic] Threshold Feature');
  expect(casterHud.labels).not.toContain('[SW Fix Diagnostic] Blank Feature');
  await page.screenshot({ path: testInfo.outputPath('combat-hud-layout.png') });
  await page.evaluate(() => canvas.tokens.releaseAll());
  await expect(page.locator('.swords-wizardry-combat-hud')).toHaveCount(0);
}

async function cleanupDiagnostics(page) {
  if (!page || page.isClosed()) return;
  await page.evaluate(async (diagnosticId) => {
    if (game.ready && game.user.isGM) await game.modules.get(diagnosticId)?.api?.cleanup?.();
  }, DIAGNOSTIC_ID).catch(() => {});
}

function collectEvidence(page) {
  const evidence = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      evidence.push({ type: `console:${message.type()}`, text: message.text() });
    }
  });
  page.on('pageerror', (error) => evidence.push({ type: 'pageerror', text: error.message }));
  page.on('requestfailed', (request) => evidence.push({
    type: 'requestfailed',
    method: request.method(),
    path: new URL(request.url()).pathname,
    message: request.failure()?.errorText ?? 'unknown'
  }));
  return evidence;
}

function criticalEvidence(evidence) {
  return evidence.filter((entry) => (
    !(
      entry.type === 'console:error'
      && entry.text.startsWith('Foundry Virtual Tabletop requires a screen resolution')
    )
    && ['console:error', 'pageerror', 'requestfailed'].includes(entry.type)
  ));
}

async function attachJson(testInfo, name, value) {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(value, null, 2)),
    contentType: 'application/json'
  });
}
