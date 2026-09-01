# Swords & Wizardry Fixes — Human Test Plan

## 1. Purpose

Use this checklist to manually validate the fixes described in
`SW_FIXES_DESIGN.md` and `SW_FIXES_IMPLEMENTATION_PLAN.md`. Run the applicable
tests on both Foundry VTT v13 and v14 before release or upstream submission.

This plan complements the automated suite. It concentrates on behavior a human
can best judge: workflow clarity, permissions, chat-card usability, theme and
layout quality, and persistence across reloads.

## 2. Safety and acceptance rules

- Use disposable test worlds or restored copies. Do not run destructive tests
  against a live campaign world.
- Install the release archive, not a development symlink:
  `dist/swords-wizardry.zip`.
- Confirm the installed directory and manifest ID are both `swords-wizardry`.
- Record a screenshot and browser-console excerpt for every failure.
- After any HP test, compare the Actor or synthetic Token Actor that was
  actually targeted. Do not silently substitute a base Actor for an unlinked
  Token Actor.
- Stop the release if a player can perform a GM-only mutation, one action is
  applied twice, a failed creation leaves an orphan Document, a reload changes
  persisted state, or an unexpected browser error occurs.

## 3. Candidate under test

Record these fields at the start of the manual run:

| Field | Value |
| --- | --- |
| System version | 4.2.0 |
| Archive SHA-256 | `2ef90207047cdb38f3f23efeceebbc39d798b653f2e68904d05320d844c04251` |
| Foundry v13 build | 13.351 |
| Foundry v14 build | 14.367 |
| Test date | |
| Tester | |

The automated release-shaped baseline passed on 2026-08-31:

- v13 evidence: `RuntimeTests/v13/Evidence/fixes-20260831-015513`
- v14 evidence: `RuntimeTests/v14/Evidence/fixes-20260831-015412`
- v14 was exercised under the `/sw-fixes/` route prefix.
- Both servers used isolated data paths, stopped after testing, and reported
  their test ports closed.

## 4. Test-world setup

Create or confirm all of the following:

- Two GM users: **GM A** and **GM B**.
- One ordinary player without `ACTOR_CREATE`.
- One trusted player granted `ACTOR_CREATE` in Foundry's Role Permissions.
- A player-owned character with a linked Token.
- An NPC with an unlinked Token.
- An NPC prototype with `0/0` HP and valid Hit Dice such as `2d8`.
- A weapon with a deterministic attack bonus and damage formula such as `2`.
- A prepared level-1 spell with two prepared occurrences.
- A damage Spell Effect using `2` for deterministic HP tests.
- A healing Spell Effect using `3` for deterministic HP tests.
- A caster-level damage Spell Effect using `(@spell.casterLevel)d6`.
- A description-only Feature whose formula is blank.

For each numbered section below, record **Pass**, **Fail**, or **Not run** for
both generations.

## 5. Installation, startup, and package boundary

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Archive installs and the system appears once in Setup | | | |
| Existing test world launches without a migration error | | | |
| System can be disabled, enabled, and reloaded cleanly | | | |
| Browser console has no unexpected error or deprecation warning | | | |
| v14 works through a non-empty route prefix | | | |

Inspect the installed package. It must not contain `tests/`, `scripts/`,
`node_modules/`, source maps, `RuntimeTests/`, `CODE_REVIEW.md`,
`SW_FIXES_DESIGN.md`, `SW_FIXES_IMPLEMENTATION_PLAN.md`, or this manual plan.

## 6. System setting and HP behavior

### 6.1 Manual application enabled

Check **DM must apply damage / healing**.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Damage Spell Effect creates a result card without changing HP | | | |
| Healing Spell Effect creates a result card without changing HP | | | |
| GM sees Damage, Half, Double, and healing controls as applicable | | | |
| Player sees the result and target name but no apply controls | | | |
| Damage applies once to the displayed target | | | |
| Healing applies once and does not exceed maximum HP | | | |
| Double-clicking or retrying does not apply a second mutation | | | |
| Reloading preserves HP and the applied status | | | |
| A new casting has fresh controls even if an older card was applied | | | |

Also verify that the spell damage result uses the weapon-card visual language:
outlined target row, target name, matching buttons, matching font, and readable
status text.

### 6.2 Automatic application enabled

Uncheck **DM must apply damage / healing**.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Player-cast damage applies immediately and exactly once | | | |
| Player-cast healing applies immediately and exactly once | | | |
| Weapon damage applies immediately and exactly once | | | |
| Automatic result cards contain no manual apply controls | | | |
| Result card still identifies the source and affected target | | | |

Restore the original setting after this section.

## 7. Spell Effects editor and casting

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| The editor is named **Spell Effects**, not Structured Actions | | | |
| Add, edit, reorder, and remove effects; save; close and reopen | | | |
| Saved effects retain their order and values | | | |
| Fields change appropriately for damage, healing, roll, and manual effects | | | |
| Unsupported formula references show a bounded validation message | | | |
| `(@spell.casterLevel)d6` rolls one d6 per resolved caster level | | | |
| Automatic and fixed caster-level sources resolve correctly | | | |
| Keyboard activation works for Add, Move, Delete, Save, and effect buttons | | | |
| Adding an effect moves focus to the new row without losing the draft | | | |

Prepared-spell checks:

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| **Post** creates a card without consuming preparation | | | |
| **Cast** consumes exactly one prepared occurrence | | | |
| Cancelling a required caster-level prompt consumes nothing | | | |
| Two near-simultaneous casts cannot consume the same occurrence twice | | | |
| A card records and displays a failed consumption audit if persistence fails | | | |

## 8. Authority, trust, and historical cards

Run this section with GM A and a player connected at the same time.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Player requests produce GM-authored spell and weapon result cards | | | |
| Only the active GM performs shared HP and prepared-slot writes | | | |
| A non-GM-authored current-looking card has no mutation controls | | | |
| A historical spell card remains visible but is display-only | | | |
| A historical weapon card remains visible but is display-only | | | |
| Historical cards show the localized repost/reroll notice | | | |
| A malformed or stale source produces one bounded notice, not a mutation | | | |

Failover:

1. Connect GM A, GM B, and the player.
2. Note which GM Foundry identifies as active.
3. Close that GM client.
4. Wait until the other GM becomes active.
5. Have the player invoke a damage Spell Effect.
6. Confirm the new active GM authors and executes the result exactly once.
7. Temporarily leave no active GM and confirm the player receives a bounded
   failure with no HP or prepared-slot change.

## 9. Weapon workflow

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Attack card records the real weapon and selected target UUIDs | | | |
| Damage uses only targets recorded as hit by that attack | | | |
| Changing target selection after the attack does not redirect damage | | | |
| Linked and unlinked Token targets both update the correct Actor | | | |
| Manual Damage, Half, Double, and healing buttons apply correct amounts | | | |
| A second click or reload cannot repeat an already applied result | | | |
| Missing weapon, target, or attack message fails without mutation | | | |

## 10. Rolls and chat visibility

Test each available roll visibility mode: public, private GM, blind GM, and
self roll.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Saving throw uses the source Actor as speaker | | | |
| Formula Feature rolls once and uses the source Actor as speaker | | | |
| Blank-formula Feature posts one enriched description and does not recurse | | | |
| Morale result is visible only to GMs | | | |
| Non-owner cannot request morale for an NPC they do not own | | | |
| Each mode reaches only its intended recipients | | | |
| v14 produces no `core.rollMode` deprecation warning | | | |

## 11. Combat and side initiative

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Creating, updating, and deleting Combat preserves normal tracker behavior | | | |
| Roll All produces one party roll and one opponent roll | | | |
| All friendly combatants share the party result | | | |
| Neutral/hostile combatants share the opponent result | | | |
| One public summary message is created | | | |
| Turn is set coherently and the current owned Token is focused | | | |
| Empty Combat fails safely without partial updates | | | |
| Rapid Combat changes produce no tracker page error | | | |

## 12. NPC Token HP persistence

1. Confirm the test NPC's base Actor has `0/0` HP and valid Hit Dice.
2. Create an unlinked Token from it as the active GM.
3. Confirm the Token's synthetic Actor receives one positive HP roll.
4. Confirm the base Actor remains `0/0`.
5. Reload the world and confirm the Token retains the same HP.
6. Create a linked Token and confirm the system does not roll Token-specific HP.
7. Repeat with invalid Hit Dice and confirm one warning appears and no corrupt
   HP value is stored.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Unlinked Token ActorDelta persists one roll | | | |
| Linked/non-NPC/nonzero-HP cases are not rerolled | | | |
| Invalid Hit Dice fails safely | | | |

## 13. Combat HUD lifecycle

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Selecting one owned Token opens one HUD | | | |
| Selecting two owned Tokens opens one HUD per Token | | | |
| Deselecting one Token closes only its HUD | | | |
| Scene change and Token deletion remove stale HUDs | | | |
| Rapid select/deselect does not recreate a stale HUD | | | |
| Save, item, and spell controls call the normal system workflows | | | |
| HUD spell casting consumes preparation through the safe cast service | | | |
| Repeated open/close cycles do not duplicate actions or listeners | | | |
| HUD stays inside an 800×600 viewport | | | |

## 14. Stat-block importer

As a GM, import:

```text
Test Goblin: HD 1d6; AC 6 [13]; Attack Spear (1d6); Move 9; Save 18; Morale 7; Alignment chaotic; CL/XP 1/15
```

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| GM sees the importer; non-GM does not | | | |
| Valid input creates one Actor with embedded attack Items | | | |
| No orphan world Item is created | | | |
| Unknown segments are preserved diagnostically | | | |
| Malformed HD, attack, CL/XP, or oversized input creates nothing | | | |
| Validation remains visible and the submitted draft is retained | | | |
| Repeated submit while pending creates at most one Actor | | | |

## 15. Character creator and ownership

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| User without `ACTOR_CREATE` sees no creator button | | | |
| Trusted user with `ACTOR_CREATE` sees and can use the creator | | | |
| Permission is rechecked when the form is submitted | | | |
| Blank/oversized name and invalid folder fail without an Actor | | | |
| Successful Actor gives creator OWNER and everyone else NONE | | | |
| Roll/create failure leaves the form open with its draft intact | | | |
| Repeated submit while pending creates at most one Actor | | | |

## 16. Data-model and source-data checks

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Item quantity `0` contributes zero encumbrance | | | |
| Quantity and weight reject new negative values | | | |
| Character level and other corrected defaults persist as entered | | | |
| AC/AAC paired updates accept zero and remain synchronized | | | |
| Inconsistent simultaneous AC/AAC update fails rather than guessing | | | |
| Existing spell, weapon, feature, Actor, and NPC data opens without loss | | | |

For a read-only check of legacy negative source values, run as GM:

```js
game.swordswizardry.diagnostics.findNegativeItemValues()
```

Confirm it returns findings without changing any Item. This diagnostic is not
an automatic migration or repair tool.

## 17. Removed/dead behavior

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Actor and Item sheets show no obsolete Active Effect controls | | | |
| No old generic RPC or client-authored damage route is reachable | | | |
| Old attack/damage roll templates are not requested | | | |
| Missing removed files do not create a 404 or console error | | | |

## 18. Localization, themes, accessibility, and layout

Run in English, German, and Spanish where practical. Also test Foundry's
default light/dark presentation and the Carolingian UI module if it is part of
the supported table setup.

| Check | v13 | v14 | Notes/evidence |
| --- | --- | --- | --- |
| Touched settings, importer, creator, HUD, roll, and card strings localize | | | |
| No raw localization key or replacement character is visible | | | |
| Spell cards inherit theme text colors | | | |
| Headings have no readability-reducing text shadow | | | |
| Target names, totals, and status text remain readable in both themes | | | |
| Controls have accessible names and visible keyboard focus | | | |
| Editor and HUD remain usable at 800×600 and 200% browser zoom | | | |
| Long Actor, Item, spell, and target names wrap without overlap | | | |

## 19. Final regression pass

- [ ] Create, open, edit, and delete each Actor and Item type.
- [ ] Drag an owned Item to the hotbar and run the generated macro.
- [ ] Confirm macros reject unowned/world Items with a localized notice.
- [ ] Reload after spell preparation, HP changes, Token HP generation, and
  character/import creation; confirm all intended state persists.
- [ ] Confirm no unexpected browser console error, page error, failed request,
  or notification occurred during the complete run.
- [ ] Confirm no diagnostic fixture whose name begins `[SW Fix Diagnostic]`
  remains after cleanup.

## 20. Completion record

| Generation | Overall result | Tester | Date | Evidence location |
| --- | --- | --- | --- | --- |
| Foundry 13.351 | | | | |
| Foundry 14.367 | | | | |

Open a defect for every failed row. Include the section/check, Foundry build,
system version, user role, setting state, linked/unlinked Token status,
reproduction steps, expected and actual behavior, console output, and a
screenshot or trace location.
