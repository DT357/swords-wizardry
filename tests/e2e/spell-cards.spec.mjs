import { expect, test } from '@playwright/test';

const DIAGNOSTIC_ID = 'swords-wizardry-spell-diagnostics';
const SYSTEM_ID = 'swords-wizardry';
const runtimeEnabled = process.env.SW_FOUNDRY_E2E === '1';

test.describe('Swords & Wizardry spell cards in Foundry', () => {
  test.skip(!runtimeEnabled, 'Set SW_FOUNDRY_E2E=1 for an authorized disposable-world run.');

  test('GM diagnostic, Item editor, cards, keyboard, and constrained layout', async ({ page }, testInfo) => {
    const runtime = runtimeConfiguration();
    const evidence = collectEvidence(page);
    await joinWorld(page, runtime.gm);
    await assertDisposableRuntime(page, runtime);

    let report;
    try {
      report = await page.evaluate(async ({ diagnosticId, ownerName }) => {
        const owner = game.users.getName(ownerName);
        if (!owner || owner.isGM) throw new Error(`Missing non-GM fixture owner: ${ownerName}`);
        return game.modules.get(diagnosticId).api.run({
          retainFixtures: true,
          ownerUserId: owner.id
        });
      }, { diagnosticId: DIAGNOSTIC_ID, ownerName: runtime.player.name });

      expect(report.failed, JSON.stringify(report.tests, null, 2)).toBe(0);
      expect(report.cleanup.status).toBe('retained');
      await attachReport(testInfo, report);

      const spellSheet = await openFixtureSpellSheet(page, report.fixtures.damageSpellUuid);
      const editActions = spellSheet.locator('button[data-action="editSpellActions"]');
      await expect(editActions).toBeVisible();
      await expect(spellSheet.locator('.spell-actions-summary h3')).toHaveText('Spell Effects');
      await expect(editActions).toHaveText(/Edit Spell Effects/);
      await editActions.click();

      const editor = page.locator('form.spell-action-editor');
      await expect(editor).toBeVisible();
      await expect(editor.locator('.spell-action-editor__toolbar')).toContainText('effects');
      const firstEffect = editor.locator('[data-action-index="0"]');
      await expect(firstEffect.locator('[data-effect-field="formula"]')).toBeVisible();
      await expect(firstEffect.locator('[data-effect-field="target"]')).toBeVisible();
      await expect(firstEffect.locator('[data-effect-field="save"]')).toBeVisible();
      await expect(firstEffect.locator('[data-effect-field="attack"]')).toBeHidden();
      await expect(firstEffect.locator('[data-effect-field="reference"]')).toBeHidden();
      await expect(firstEffect.locator('[data-effect-field="notes"]')).toBeHidden();
      const firstLabel = editor.locator('input[name="actions.0.label"]');
      const retainedDraft = 'Long localized diagnostic action label retained across a rerender';
      await firstLabel.fill(retainedDraft);

      const addButton = editor.locator('button[data-action="addAction"]');
      const labelInputs = editor.locator('input[name^="actions."][name$=".label"]');
      const addedActionIndex = await labelInputs.count();
      await addButton.focus();
      await page.keyboard.press('Enter');
      await expect(editor.locator(`input[name="actions.${addedActionIndex}.label"]`)).toBeFocused();
      await expect(editor.locator('input[name="actions.0.label"]')).toHaveValue(retainedDraft);

      const addedEffect = editor.locator(`[data-action-index="${addedActionIndex}"]`);
      await expect(addedEffect.locator('[data-effect-field="formula"]')).toBeHidden();
      await expect(addedEffect.locator('[data-effect-field="target"]')).toBeVisible();
      await expect(addedEffect.locator('[data-effect-field="save"]')).toBeHidden();
      await expect(addedEffect.locator('[data-effect-field="attack"]')).toBeHidden();
      await expect(addedEffect.locator('[data-effect-field="reference"]')).toBeHidden();
      await expect(addedEffect.locator('[data-effect-field="notes"]')).toBeVisible();

      await addedEffect.locator(`select[name="actions.${addedActionIndex}.kind"]`).selectOption('attack');
      await expect(addedEffect.locator('[data-effect-field="formula"]')).toBeVisible();
      await expect(addedEffect.locator('[data-effect-field="attack"]')).toBeVisible();
      await expect(addedEffect.locator('[data-effect-field="notes"]')).toBeHidden();
      await addedEffect.locator(`select[name="actions.${addedActionIndex}.attack.mode"]`).selectOption('custom');
      await expect(addedEffect.locator('[data-effect-field="attack-notes"]')).toBeVisible();
      await addedEffect.locator(`select[name="actions.${addedActionIndex}.kind"]`).selectOption('manual');

      await page.setViewportSize({ width: 800, height: 600 });
      const layout = await editor.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        viewport: document.documentElement.clientWidth,
        duplicateIds: [...element.querySelectorAll('[id]')]
          .map((node) => node.id)
          .filter((id, index, ids) => ids.indexOf(id) !== index)
      }));
      expect(layout.width).toBeLessThanOrEqual(layout.viewport);
      expect(layout.duplicateIds).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('gm-constrained-editor.png'), fullPage: true });

      const persistedAddedLabel = 'Persisted diagnostic action';
      await editor.locator(`input[name="actions.${addedActionIndex}.label"]`).fill(persistedAddedLabel);
      await editor.locator('button[type="submit"]').click();
      await expect(editor).toBeHidden();
      await expect.poll(() => page.evaluate(async ({ uuid, expectedLabels }) => {
        const item = await fromUuid(uuid);
        return expectedLabels.every(({ index, label }) => item.system.actions[index]?.label === label);
      }, {
        uuid: report.fixtures.damageSpellUuid,
        expectedLabels: [
          { index: 0, label: retainedDraft },
          { index: addedActionIndex, label: persistedAddedLabel }
        ]
      })).toBe(true);

      await editActions.click();
      await expect(editor).toBeVisible();
      await expect(editor.locator('input[name="actions.0.label"]')).toHaveValue(retainedDraft);
      await expect(editor.locator(`input[name="actions.${addedActionIndex}.label"]`)).toHaveValue(persistedAddedLabel);
      await closeApplication(page, 'form.spell-action-editor');
      const preparedBefore = await preparedCount(page, report.fixtures.damageSpellUuid);
      const cardsBefore = await spellMessageCount(page, 'spell-card');
      await spellSheet.locator('button[data-action="spellPost"]').click();
      await expect.poll(() => spellMessageCount(page, 'spell-card')).toBe(cardsBefore + 1);
      await expect.poll(() => preparedCount(page, report.fixtures.damageSpellUuid)).toBe(preparedBefore);

      await spellSheet.locator('button[data-action="spellCast"]').click();
      await expect.poll(() => preparedCount(page, report.fixtures.damageSpellUuid)).toBe(preparedBefore - 1);
      await closeApplication(page, 'form.swords-wizardry.sheet.item');

      await page.evaluate(() => ui.chat?.scrollBottom?.());
      const castMessage = page.locator(
        `#sidebar #chat [data-message-id="${report.fixtures.castMessageId}"] [data-spell-message-kind="spell-card"]`
      );
      await expect(castMessage).toBeVisible();
      const themedTypography = await castMessage.evaluate((element) => {
        const originalColor = element.style.color;
        element.style.color = 'rgb(230, 231, 232)';
        const nodes = [
          element.querySelector('h3'),
          element.querySelector('h4'),
          element.querySelector('dt'),
          element.querySelector('dd')
        ];
        const styles = nodes.map((node) => getComputedStyle(node));
        const snapshot = {
          cardColor: getComputedStyle(element).color,
          childColors: styles.map((style) => style.color),
          textShadows: styles.map((style) => style.textShadow),
          metadataLabelWeight: styles[2].fontWeight,
          buttonTextShadow: getComputedStyle(element.querySelector('button')).textShadow
        };
        element.style.color = originalColor;
        return snapshot;
      });
      expect(themedTypography.childColors).toEqual([
        themedTypography.cardColor,
        themedTypography.cardColor,
        themedTypography.cardColor,
        themedTypography.cardColor
      ]);
      expect(themedTypography.textShadows).toEqual(['none', 'none', 'none', 'none']);
      expect(themedTypography.metadataLabelWeight).toBe('400');
      expect(themedTypography.buttonTextShadow).toBe('none');
      const actionButton = castMessage.locator(
        'button[data-action="spellAction"][data-spell-action-id="diagnostic-roll"]'
      );
      await expect(actionButton).toBeVisible();
      const resultCountBefore = await page.evaluate(() => (
        game.messages.filter((message) => (
          message.getFlag('swords-wizardry', 'spell')?.messageKind === 'spell-result'
        )).length
      ));
      await actionButton.focus();
      await expect(actionButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => (
        game.messages.filter((message) => (
          message.getFlag('swords-wizardry', 'spell')?.messageKind === 'spell-result'
        )).length
      ))).toBe(resultCountBefore + 1);
      expect(criticalEvidence(evidence)).toEqual([]);
    } finally {
      await cleanupDiagnostics(page);
      await attachEvidence(testInfo, evidence);
    }
  });

  test('owning player can invoke while HP application remains GM-only', async ({ browser }, testInfo) => {
    const runtime = runtimeConfiguration();
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();
    const gmEvidence = collectEvidence(gmPage);
    const playerEvidence = collectEvidence(playerPage);

    try {
      await joinWorld(gmPage, runtime.gm);
      await joinWorld(playerPage, runtime.player);
      await assertDisposableRuntime(gmPage, runtime);
      await assertDisposableRuntime(playerPage, runtime);

      const report = await gmPage.evaluate(async ({ diagnosticId, ownerName }) => {
        const owner = game.users.getName(ownerName);
        if (!owner || owner.isGM) throw new Error(`Missing non-GM fixture owner: ${ownerName}`);
        return game.modules.get(diagnosticId).api.run({
          retainFixtures: true,
          ownerUserId: owner.id
        });
      }, { diagnosticId: DIAGNOSTIC_ID, ownerName: runtime.player.name });
      expect(report.failed, JSON.stringify(report.tests, null, 2)).toBe(0);
      await attachReport(testInfo, report);

      await gmPage.evaluate(() => ui.chat?.scrollBottom?.());
      const gmResult = gmPage.locator(
        `#sidebar #chat [data-message-id="${report.fixtures.pendingResultMessageId}"] [data-spell-message-kind="spell-result"]`
      );
      const initialApplyButton = gmResult.locator(
        '[data-action="spellApply"][data-multiplier="1"]'
      );
      await expect(initialApplyButton).toBeVisible();
      const foreignApplicationId = await gmPage.evaluate(async ({ priorId, pendingId }) => {
        const prior = game.messages.get(priorId);
        const pending = game.messages.get(pendingId);
        const priorSpell = prior.getFlag('swords-wizardry', 'spell');
        const pendingSpell = foundry.utils.deepClone(
          pending.getFlag('swords-wizardry', 'spell')
        );
        const [foreignId, foreignEntry] = Object.entries(priorSpell.application.entries)[0];
        pendingSpell.application = {
          entries: { [foreignId]: foundry.utils.deepClone(foreignEntry) }
        };
        await pending.update({ 'flags.swords-wizardry.spell': pendingSpell });
        return foreignId;
      }, {
        priorId: report.fixtures.damageResultMessageId,
        pendingId: report.fixtures.pendingResultMessageId
      });
      await gmResult.evaluate((root, messageId) => {
        Hooks.callAll('renderChatMessageHTML', game.messages.get(messageId), root, {});
      }, report.fixtures.pendingResultMessageId);
      await expect(initialApplyButton).toBeVisible();

      await playerPage.evaluate(() => ui.chat?.scrollBottom?.());
      const playerCard = playerPage.locator(
        `#sidebar #chat [data-message-id="${report.fixtures.permissionCardMessageId}"] [data-spell-message-kind="spell-card"]`
      );
      await expect(playerCard).toBeVisible();
      const playerAction = playerCard.locator(
        'button[data-action="spellAction"][data-spell-action-id="diagnostic-roll"]'
      );
      await playerAction.focus();
      await expect(playerAction).toBeFocused();
      await playerPage.keyboard.press('Enter');

      await expect.poll(() => playerPage.evaluate((ownerId) => (
        game.messages.some((message) => {
          const spell = message.getFlag('swords-wizardry', 'spell');
          return spell?.messageKind === 'spell-result' && message.author?.id === ownerId;
        })
      ), report.fixtures.ownerUserId)).toBe(true);

      const directApplication = await playerPage.evaluate(async (messageUuid) => {
        const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
        const message = await resolveUuid(messageUuid);
        const spell = message.getFlag('swords-wizardry', 'spell');
        return game.swordswizardry.spells.requestApplication(message, {
          targetUuid: spell.targetUuids[0],
          kind: spell.action.kind,
          multiplier: 1
        });
      }, report.fixtures.pendingResultMessageUuid);
      expect(directApplication).toMatchObject({ status: 'failure', code: 'GM_REQUIRED' });

      const playerResult = playerPage.locator(
        `#sidebar #chat [data-message-id="${report.fixtures.pendingResultMessageId}"] [data-spell-message-kind="spell-result"]`
      );
      await expect(playerResult.locator('[data-action="spellApply"]')).toHaveCount(0);

      const damageTarget = gmResult.locator('.spell-result__target').first();
      await expect(damageTarget).toHaveClass(/damage-target/);
      await expect(damageTarget.locator('.spell-result__target-name')).toHaveClass(/target-name/);
      const damageControls = damageTarget.locator('.spell-result__application-controls');
      await expect(damageControls).toHaveClass(/damage-buttons/);
      await expect(damageControls.locator('button')).toHaveText(['Damage', 'Half', 'Double']);
      const damageLayout = await damageTarget.evaluate((element) => {
        const controls = element.querySelector('.damage-buttons');
        const button = controls?.querySelector('button');
        const targetStyle = getComputedStyle(element);
        const controlsStyle = controls ? getComputedStyle(controls) : null;
        const buttonStyle = button ? getComputedStyle(button) : null;
        return {
          borderStyle: targetStyle.borderTopStyle,
          borderWidth: targetStyle.borderTopWidth,
          fontFamily: targetStyle.fontFamily,
          controlsDisplay: controlsStyle?.display,
          buttonFontSize: buttonStyle?.fontSize,
          buttonFlexGrow: buttonStyle?.flexGrow
        };
      });
      expect(damageLayout).toMatchObject({
        borderStyle: 'solid',
        borderWidth: '1px',
        controlsDisplay: 'flex',
        buttonFontSize: '11px',
        buttonFlexGrow: '1'
      });
      expect(damageLayout.fontFamily).toContain('Libre Baskerville');
      const applyButton = gmResult.locator('[data-action="spellApply"][data-multiplier="1"]');
      await expect(applyButton).toBeVisible();
      await applyButton.focus();
      await expect(applyButton).toBeFocused();
      await gmPage.keyboard.press('Enter');
      await expect(gmResult.locator('.spell-result__application-status')).not.toHaveText('');
      await expect.poll(() => gmPage.evaluate(({ messageId, foreignId }) => {
        const entries = game.messages.get(messageId)
          .getFlag('swords-wizardry', 'spell').application.entries;
        return Object.keys(entries).length === 1 && !Object.hasOwn(entries, foreignId);
      }, {
        messageId: report.fixtures.pendingResultMessageId,
        foreignId: foreignApplicationId
      })).toBe(true);

      await gmPage.screenshot({ path: testInfo.outputPath('gm-application.png'), fullPage: true });
      await playerPage.screenshot({ path: testInfo.outputPath('player-permissions.png'), fullPage: true });
      expect(criticalEvidence(gmEvidence)).toEqual([]);
      expect(criticalEvidence(playerEvidence)).toEqual([]);
    } finally {
      await cleanupDiagnostics(gmPage);
      await attachEvidence(testInfo, gmEvidence, 'gm-runtime-events.json');
      await attachEvidence(testInfo, playerEvidence, 'player-runtime-events.json');
      await gmContext.close();
      await playerContext.close();
    }
  });
});

function runtimeConfiguration() {
  const configuration = {
    worldId: process.env.SW_FOUNDRY_WORLD_ID,
    disposable: process.env.SW_FOUNDRY_DISPOSABLE_WORLD,
    gm: userConfiguration('GM'),
    player: userConfiguration('PLAYER')
  };
  if (configuration.disposable !== 'YES') {
    throw new Error('Set SW_FOUNDRY_DISPOSABLE_WORLD=YES only for a disposable test world.');
  }
  if (!configuration.worldId) throw new Error('SW_FOUNDRY_WORLD_ID is required.');
  return configuration;
}

function userConfiguration(role) {
  const name = process.env[`SW_FOUNDRY_${role}_NAME`];
  if (!name) throw new Error(`SW_FOUNDRY_${role}_NAME is required.`);
  return {
    name,
    password: process.env[`SW_FOUNDRY_${role}_PASSWORD`] ?? ''
  };
}

async function joinWorld(page, user) {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: ''
  }));
  await page.goto('/');
  if (!await foundryReady(page)) {
    const loginIdentity = page.locator('select[name="userid"], input[name="username"]').first();
    await expect(loginIdentity).toBeVisible();
    const userSelect = page.locator('select[name="userid"]');
    if (await userSelect.isVisible()) {
      await userSelect.selectOption({ label: user.name });
    } else {
      await page.locator('input[name="username"]').fill(user.name);
    }
    const password = page.locator('input[name="password"]');
    if (await password.count()) await password.fill(user.password);
    await page.locator('button[name="join"], button[type="submit"]').first().click();
    await page.waitForFunction(() => globalThis.game?.ready === true);
  }
  await dismissFirstLoginConfiguration(page);
}

async function foundryReady(page) {
  return page.evaluate(() => globalThis.game?.ready === true).catch(() => false);
}

async function dismissFirstLoginConfiguration(page) {
  const userConfig = page.locator('.user-config').last();
  if (!await userConfig.isVisible().catch(() => false)) return;
  const closeButton = userConfig.locator('.window-header [data-action="close"]');
  await closeButton.focus();
  await page.keyboard.press('Enter');
  await expect(userConfig).not.toBeVisible();
}

async function assertDisposableRuntime(page, runtime) {
  const actual = await page.evaluate((diagnosticId) => ({
    worldId: game.world?.id,
    systemId: game.system?.id,
    diagnosticActive: game.modules.get(diagnosticId)?.active === true,
    isGM: game.user?.isGM === true
  }), DIAGNOSTIC_ID);
  expect(actual.worldId).toBe(runtime.worldId);
  expect(actual.systemId).toBe(SYSTEM_ID);
  expect(actual.diagnosticActive).toBe(true);
}

async function openFixtureSpellSheet(page, spellUuid) {
  await page.evaluate(async (uuid) => {
    const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
    const spell = await resolveUuid(uuid);
    await spell.sheet.render(true);
  }, spellUuid);
  const sheet = page.locator('form.swords-wizardry.sheet.item').last();
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeApplication(page, selector) {
  const application = page.locator(selector).last();
  const closeButton = application.locator('.window-header [data-action="close"]').first();
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(application).not.toBeVisible();
}

async function preparedCount(page, spellUuid) {
  return page.evaluate(async (uuid) => {
    const resolveUuid = foundry.utils.fromUuid ?? globalThis.fromUuid;
    const spell = await resolveUuid(uuid);
    return spell.actor.system.spellSlots[spell.system.spellLevel].memorized
      .filter((id) => id === spell.id).length;
  }, spellUuid);
}

async function spellMessageCount(page, messageKind) {
  return page.evaluate((kind) => game.messages.filter((message) => (
    message.getFlag('swords-wizardry', 'spell')?.messageKind === kind
  )).length, messageKind);
}

async function cleanupDiagnostics(page) {
  if (page.isClosed()) return;
  await page.evaluate(async (diagnosticId) => {
    if (globalThis.game?.ready && game.user?.isGM) {
      await game.modules.get(diagnosticId)?.api?.cleanup?.();
    }
  }, DIAGNOSTIC_ID).catch(() => {});
}

function collectEvidence(page) {
  const events = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      events.push({ type: `console:${message.type()}`, text: message.text() });
    }
  });
  page.on('pageerror', (error) => events.push({ type: 'pageerror', text: error.message }));
  page.on('requestfailed', (request) => events.push({
    type: 'requestfailed',
    method: request.method(),
    path: new URL(request.url()).pathname,
    failure: request.failure()?.errorText ?? 'unknown'
  }));
  return events;
}

function criticalEvidence(evidence) {
  return evidence.filter((entry) => (
    !isExpectedCoreNoise(entry)
    && (
      entry.type === 'pageerror'
      || entry.type === 'requestfailed'
      || entry.type === 'console:error'
    )
  ));
}

function isExpectedCoreNoise(entry) {
  return entry.type === 'console:error'
    && entry.text.startsWith(
      'Foundry Virtual Tabletop requires a screen resolution of 1366px by 768px or greater.'
    );
}

async function attachEvidence(testInfo, evidence, name = 'runtime-events.json') {
  await testInfo.attach(name, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json'
  });
}

async function attachReport(testInfo, report) {
  await testInfo.attach('diagnostic-report.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json'
  });
}
