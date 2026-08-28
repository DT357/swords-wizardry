# Local spell-card review checklist

Use a newly created disposable Swords & Wizardry world. Do not enable the
diagnostic module in a live campaign.

## Automated runtime diagnostic

1. Confirm the installed Game System reports Swords & Wizardry 4.2.0.
2. Create a disposable world with that system.
3. Enable **Swords & Wizardry Spell Diagnostics** in Manage Modules.
4. Sign in as a GM and run this in the browser developer console:

   ```js
   await game.modules.get('swords-wizardry-spell-diagnostics').api.run()
   ```

5. Confirm the returned report has zero failed tests and successful cleanup.
   The default run deletes only its own flagged fixtures.

To inspect the generated Actors, Scene, Token, Items, and chat cards, rerun with
`{retainFixtures: true}`. Remove only those diagnostic fixtures afterward with:

```js
await game.modules.get('swords-wizardry-spell-diagnostics').api.cleanup()
```

## GM visual and interaction review

- Open an existing-format Spell Item and confirm its old description, level,
  range, and duration remain intact and the Spell Effects list starts empty.
- Add, remove, reorder, cancel, and save Spell Effects. Change each effect type
  and confirm only its relevant fields appear. Confirm names, keyboard focus,
  scroll position, validation messages, and long notes remain usable.
- Test fixed, prompted, automatic character-level, automatic NPC hit-die,
  explicit character-level, and explicit NPC hit-die caster sources. Confirm a
  compound character level prompts and NPC challenge level is never used.
- Confirm **Post** creates a card without spending preparation.
- Confirm **Cast** spends one occurrence only after card creation. Cancel a
  caster-level prompt and confirm it spends nothing.
- Change the Item after posting and confirm the existing card retains its
  snapshot.
- Invoke damage, healing, attack, roll, rules-reference, and Description effects.
- Change selected Tokens while a Roll is resolving and confirm the result keeps
  the original target UUIDs.
- Apply half, full, and double damage and healing. Confirm HP is bounded, applied
  amounts are shown, duplicate clicks do not apply twice, and unlinked Tokens
  update their synthetic Actors.
- Exercise public, GM, blind, and self roll modes.
- Review cards and the editor at normal and constrained viewport sizes, with a
  long Spell name and long localized labels. Check keyboard activation, visible
  focus, accessible names, and no clipped or overlapping controls.

The configuration-gated Playwright workflow in
[`docs/development.md`](development.md#playwright-gmplayer-gate) automates the
core GM/player, editor, keyboard, constrained-layout, application, evidence, and
cleanup checks after you launch this disposable world.

## Player permission review

- Join from a separate non-GM browser context.
- Confirm an owning player can Post, Cast, and invoke their caster's cards.
- Confirm an unrelated player cannot invoke the card.
- Confirm no player sees working HP-application controls and a direct call to
  `requestApplication` returns `GM_REQUIRED` without a Document write.
- Confirm a GM can see and apply a legitimate result created by the owning
  player.

## Evidence to retain

Record the exact Foundry build, system version, enabled module versions,
diagnostic report, console/page errors, failed requests, notifications, and
screenshots for normal and constrained layouts. Do not record passwords,
license data, private world content, or local personal paths.
