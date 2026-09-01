import { chromium } from '@playwright/test';

const DIAGNOSTIC_ID = 'swords-wizardry-spell-diagnostics';
const SYSTEM_ID = 'swords-wizardry';

const configuration = {
  baseUrl: requireEnvironment('SW_FOUNDRY_URL'),
  worldId: requireEnvironment('SW_FOUNDRY_WORLD_ID'),
  playerName: requireEnvironment('SW_FOUNDRY_PLAYER_NAME'),
  creatorName: process.env.SW_FOUNDRY_CREATOR_NAME ?? 'Test Creator',
  secondGmName: process.env.SW_FOUNDRY_SECOND_GM_NAME ?? 'Test GM 2',
  gmName: process.env.SW_FOUNDRY_GM_NAME ?? 'Gamemaster',
  gmPassword: process.env.SW_FOUNDRY_GM_PASSWORD ?? ''
};

if (process.env.SW_FOUNDRY_DISPOSABLE_WORLD !== 'YES') {
  throw new Error('Set SW_FOUNDRY_DISPOSABLE_WORLD=YES only for an authorized disposable test world.');
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  await joinWorld(page, configuration);
  const provisioned = await page.evaluate(async ({
    diagnosticId, playerName, creatorName, secondGmName
  }) => {
    async function ensureUser(name, role) {
      let user = game.users.getName(name);
      if (!user) {
        const UserClass = CONFIG.User.documentClass;
        user = await UserClass.create({ name, role, password: '' });
      } else if (user.role !== role) {
        await user.update({ role });
      }
      return user;
    }
    const player = await ensureUser(playerName, CONST.USER_ROLES.PLAYER);
    const creator = await ensureUser(creatorName, CONST.USER_ROLES.TRUSTED);
    const secondGm = await ensureUser(secondGmName, CONST.USER_ROLES.GAMEMASTER);
    if (player.isGM || creator.isGM || !secondGm.isGM) {
      throw new Error('Disposable test user roles are invalid.');
    }
    const module = game.modules.get(diagnosticId);
    if (!module) throw new Error(`Diagnostic module ${diagnosticId} is not installed.`);

    const moduleConfiguration = foundry.utils.deepClone(
      game.settings.get('core', 'moduleConfiguration') ?? {}
    );
    moduleConfiguration[diagnosticId] = true;
    if (!module.active) {
      await game.settings.set('core', 'moduleConfiguration', moduleConfiguration);
    }

    return {
      coreVersion: game.version,
      diagnosticWasActive: module.active,
      playerId: player.id,
      playerRole: player.role,
      creatorId: creator.id,
      creatorRole: creator.role,
      secondGmId: secondGm.id,
      secondGmRole: secondGm.role,
      systemId: game.system.id,
      systemVersion: game.system.version,
      worldId: game.world.id
    };
  }, {
    diagnosticId: DIAGNOSTIC_ID,
    playerName: configuration.playerName,
    creatorName: configuration.creatorName,
    secondGmName: configuration.secondGmName
  });

  assertRuntimeIdentity(provisioned, configuration);

  if (!provisioned.diagnosticWasActive) {
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true);
  }

  const verified = await page.evaluate((diagnosticId) => ({
    diagnosticActive: game.modules.get(diagnosticId)?.active === true,
    diagnosticApiReady: typeof game.modules.get(diagnosticId)?.api?.run === 'function',
    systemId: game.system.id,
    worldId: game.world.id
  }), DIAGNOSTIC_ID);
  assertRuntimeIdentity(verified, configuration);
  if (!verified.diagnosticActive || !verified.diagnosticApiReady) {
    throw new Error(`Diagnostic module did not activate: ${JSON.stringify(verified)}`);
  }

  process.stdout.write(`${JSON.stringify({...provisioned, ...verified}, null, 2)}\n`);
} finally {
  await browser.close();
}

async function joinWorld(page, runtime) {
  await page.goto(runtime.baseUrl);
  if (await foundryReady(page)) return;

  await page.locator('select[name="userid"], input[name="username"]').first()
    .waitFor({ state: 'visible' });
  const userSelect = page.locator('select[name="userid"]');
  if (await userSelect.isVisible()) {
    await userSelect.selectOption({ label: runtime.gmName });
  } else {
    await page.locator('input[name="username"]').fill(runtime.gmName);
  }
  const password = page.locator('input[name="password"]');
  if (await password.count()) await password.fill(runtime.gmPassword);
  await page.locator('button[name="join"], button[type="submit"]').first().click();
  await page.waitForFunction(() => globalThis.game?.ready === true);
}

async function foundryReady(page) {
  return page.evaluate(() => globalThis.game?.ready === true).catch(() => false);
}

function assertRuntimeIdentity(actual, runtime) {
  if (actual.worldId !== runtime.worldId) {
    throw new Error(`Refusing unexpected world ${actual.worldId}; expected ${runtime.worldId}.`);
  }
  if (actual.systemId !== SYSTEM_ID) {
    throw new Error(`Refusing unexpected system ${actual.systemId}; expected ${SYSTEM_ID}.`);
  }
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
