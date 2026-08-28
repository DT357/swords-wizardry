# Swords & Wizardry spell diagnostics

This test-only module exercises the spell-card workflow with real Foundry
Documents. It is deliberately excluded from system release archives.

Use only in a disposable Swords & Wizardry test world. Copy this directory to
`Data/modules/swords-wizardry-spell-diagnostics`, enable it in the test world,
sign in as a GM, and run this from the browser console:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.run()
```

The default run creates distinctly named and flagged Actors, embedded Items, an
inactive Scene, an unlinked Token, and ChatMessages. It tests Post, Cast,
prepared-spell consumption, action evaluation, GM damage/healing application,
synthetic Actor updates, audit flags, public/GM/blind/self message visibility,
clamping, and idempotency. It then deletes only its own flagged fixtures.

To retain fixtures for inspection:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.run({retainFixtures: true})
```

The Playwright GM/player suite additionally passes a non-GM `ownerUserId`.
That gives the disposable caster Actor owner permission and creates one pending
damage result for the permission and application-control checks. The returned
report identifies only those retained fixtures.

Remove retained fixtures with:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.cleanup()
```
