# Swords & Wizardry fix diagnostics

This test-only module exercises current spell, weapon, HP, Token, roll, and
Combat workflows with real Foundry Documents. It is deliberately excluded from
system release archives.

Use only in a disposable Swords & Wizardry test world. Copy this directory to
`Data/modules/swords-wizardry-spell-diagnostics`, enable it in the test world,
sign in as a GM, and run this from the browser console:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.run()
```

The default run creates distinctly named and flagged Actors, embedded Items, an
inactive Scene, unlinked Tokens, Combat, and ChatMessages. It tests current
authority-backed cards, prepared-spell consumption, weapon target snapshots,
Token ActorDelta HP, description-only features, hidden morale, and side
initiative. It then deletes only its own flagged fixtures.

To keep the explicit manual damage and healing checks deterministic, the
diagnostic temporarily enables **DM must apply damage / healing** and restores
the original world setting in its cleanup path.

To retain fixtures for inspection:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.run({retainFixtures: true})
```

The Playwright GM/player suite additionally passes a non-GM `ownerUserId`.
That gives the disposable caster Actor owner permission. The returned report
identifies only retained, diagnostic-owned fixtures.

Remove retained fixtures with:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.cleanup()
```
