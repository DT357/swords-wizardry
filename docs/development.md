# Development and verification

## Prerequisites

- Node.js with npm
- A licensed Foundry VTT v13 or v14 installation for runtime checks
- Disposable user-data directories and test worlds; never use a live world for
  diagnostic or migration tests

Install development dependencies and run the complete non-Foundry gate:

```powershell
npm install
npm run check
```

The gate parses JSON and Handlebars, verifies localization parity and manifest
references, syntax-checks runtime and diagnostic modules, runs unit/integration
tests, and rebuilds CSS.

## Release-shaped package

```powershell
npm run package
```

The packaging script reads `release-files.json`, runs the full gate, recreates
`dist`, and emits:

- `dist/swords-wizardry/` — staged install directory;
- `dist/swords-wizardry.zip` — archive with `system.json` at its root;
- `dist/system.json` — release manifest;
- `dist/SHA256SUMS.txt` — checksums for the archive and manifest.

The allowlist excludes tests, scripts, source SCSS, source maps, backup files,
dependencies, and repository metadata.

To install the staged system plus the test-only diagnostic into a local Foundry
data directory, close Foundry and run:

```powershell
.\scripts\Deploy-ReviewBuild.ps1 `
  -FoundryDataPath 'C:\path\to\FoundryVTT\Data' `
  -IncludeDiagnostics
```

The script validates the source and destination package IDs, copies through a
temporary sibling, and moves any prior install into
`Data/.codex-review-backups`. It never deletes the prior install.

## Real-Foundry diagnostic

The release-excluded module in `tests/foundry/spell-diagnostics` exercises real
Actors, Items, an inactive Scene, an unlinked Token and synthetic Actor, Rolls,
ChatMessages, prepared-spell consumption, and GM HP application. Its README
contains install and console commands. Run it only in a disposable world.

The full GM/player and visual review sequence is in
[`docs/local-review.md`](local-review.md).

## Playwright GM/player gate

Install the Chromium build used by the checked-in Playwright runner once:

```powershell
node node_modules/@playwright/test/cli.js install chromium
```

Launch an explicitly disposable world, enable the diagnostic module, and set
the following values in the same terminal. `SW_FOUNDRY_DISPOSABLE_WORLD=YES`
is a deliberate safety interlock; the tests also require the running world's
exact ID to match.

```powershell
$env:SW_FOUNDRY_E2E = '1'
$env:SW_FOUNDRY_DISPOSABLE_WORLD = 'YES'
$env:SW_FOUNDRY_URL = 'http://127.0.0.1:33333'
$env:SW_FOUNDRY_WORLD_ID = 'exact-disposable-world-id'
$env:SW_FOUNDRY_GM_NAME = 'Gamemaster'
$env:SW_FOUNDRY_GM_PASSWORD = Read-Host 'GM password'
$env:SW_FOUNDRY_PLAYER_NAME = 'Test Player'
$env:SW_FOUNDRY_PLAYER_PASSWORD = Read-Host 'Player password'
npm run test:foundry:provision
npm run test:e2e
```

The provisioning command supports both the v13 user selector and the v14
username field. It refuses to proceed without the disposable-world flag,
verifies the exact world and system IDs, creates only the named ordinary test
user when missing, and activates the installed diagnostic module. Create and
launch the disposable world through the matching Foundry setup interface
before running it.

The two-browser suite exercises the real Spell Effects editor, progressive
type-specific fields, retained drafts, persistence after saving and reopening,
keyboard activation, constrained layout, card invocation, player ownership,
GM-only HP controls, real synthetic Actors, cleanup, screenshots, and captured
console/page/network failures. Artifacts go to ignored `test-results/` and
`playwright-report/` directories. Clear the password environment variables
afterward. Running `npm run check:e2e` validates test discovery without opening
a browser or touching Foundry.

## Compatibility matrix

For a release candidate, run the staged package—not a source symlink—against:

- the oldest supported v13 build and dependency set;
- the latest stable v13 build;
- the latest stable v14 build;
- GM and non-GM clients for post/cast/invoke visibility and permissions.

Record exact core/system/module versions and artifacts under
`docs/compatibility-runs`. A passing Node suite is not a Foundry compatibility
claim.
