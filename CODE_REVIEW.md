# Swords & Wizardry System Code Review

Review date: 2026-08-28
Reviewed branch: `dev`
Reviewed commit: `e20c70ce748d08f644830cee5243f451619449e5`
Target runtimes: Foundry VTT 13.351 and 14.367

## Executive summary

The new Spell Effects implementation is the strongest part of the current codebase. It separates domain logic from Foundry adapters, validates formulas and persisted snapshots, uses stable UUIDs, clamps hit-point changes, localizes its UI, and has meaningful unit, integration, diagnostic, and Playwright coverage.

The principal risks are in older system code which predates that architecture. The most urgent issue remains the generic weapon-damage RPC: any connected client can ask every connected GM client to change an arbitrary Actor or Token's HP. The audit also found several independent defects which can affect normal play:

- Foundry's core Combat update lifecycle is completely bypassed by the custom Combat class.
- An Item of type `feature` with an empty formula recurses until the call stack fails.
- Rolled HP for newly placed unlinked NPC Tokens is assigned only to prepared data rather than persisted through a Document update.
- The Combat HUD bypasses the Spell Effects casting service and mutates prepared spell-slot arrays directly.
- The legacy weapon workflow can crash for unlinked Tokens and applies damage to the targets selected at damage-roll time rather than the attack's snapshotted hit targets.
- The stat-block importer has unawaited mutation/cleanup work which can leave temporary world Items behind.

The existing `npm run check` gate passes, including 57 Node tests, JSON/localization/manifest/template checks, syntax checks, and a production CSS build. Those tests are concentrated on Spell Effects. The package gate only **lists** Playwright tests; it does not run a browser test. Existing dated evidence records successful Spell Effects runs on Foundry 13.351 and 14.367, but it does not cover most of the legacy paths identified below.

## Severity guide

| Severity | Meaning |
| --- | --- |
| Critical | A connected user can bypass authority boundaries or corrupt shared game state. |
| High | A normal workflow can fail, lose state, or break a Foundry core lifecycle. |
| Medium | A bounded workflow is unreliable, incompatible, race-prone, or insufficiently validated. |
| Low | Maintainability, accessibility, localization, packaging, or diagnostic debt with limited immediate impact. |

## Findings

### SW-01 — Critical — The legacy RPC permits unauthorized and duplicate HP mutations

**Evidence:** [`module/helpers/rpc.mjs`](module/helpers/rpc.mjs#L1-L37), [`module/swords-wizardry.mjs`](module/swords-wizardry.mjs#L146-L162), [`module/rolls/rolls.mjs`](module/rolls/rolls.mjs#L60-L76), and [`module/helpers/overrides.mjs`](module/helpers/overrides.mjs#L52-L101).

The socket receiver accepts a client-provided `operation`, target ID, recipient, and amount without an authenticated caller, ownership check, strict schema, amount bound, or source-message proof. Every connected GM executes the same request because the receiver checks only `game.user.isGM`; two GMs therefore apply the same damage twice. A malicious client can emit directly to `system.swords-wizardry` and damage any world Actor or Token visible by ID.

There are additional reliability problems:

- `...data` can overwrite the generated `type` and `requestId` fields.
- Target IDs are resolved against `game.actors` and the current Canvas instead of stable UUIDs.
- Actor updates are not awaited, so the RPC reports completion before the mutation finishes and update failures escape the caller.
- Amounts may be negative, non-finite, or arbitrarily large, and HP is not clamped.
- `requestId` is generated but never used for idempotency.

**Recommended fix:** Remove the generic `run(data)` dispatcher. Reuse or generalize the Spell Effects application service for weapon damage: one active GM, a narrow operation allowlist, authenticated transport identity, strict request validation, a stable message/action/target UUID snapshot, finite bounded amounts, HP clamping, awaited writes, and a persisted idempotency/audit entry. If the transport cannot provide a trustworthy sender identity, it is not suitable as an authorization boundary.

**Tests:** forged operation/target/amount, non-owner caller, duplicate request, two active GMs, stale/deleted target, unlinked Token, negative/NaN/infinite amount, update rejection, and repeated request after reload.

### SW-02 — High — The Combat override skips Foundry's core update lifecycle

**Evidence:** [`module/combat/combat.mjs`](module/combat/combat.mjs#L16-L37) and [`module/combat/combat.mjs`](module/combat/combat.mjs#L100-L117).

`SwordsWizardryCombat._onUpdate` never calls `super._onUpdate`. In both reviewed Foundry versions, the parent method updates current/previous turn state, manages turn events, refreshes combatant Actors and the tracker, updates token markers, and emits combat sound cues. All of that is skipped for every Combat update.

The same class also:

- refreshes `game.combat` rather than `this`, which can refresh the wrong encounter or throw when none is viewed;
- dereferences `this.combatant.token` before checking that a combatant and token exist;
- assumes `canvas` is ready when panning; and
- makes the Document callback asynchronous even though Foundry's core lifecycle does not rely on awaiting custom asynchronous work here.

**Recommended fix:** Call the parent callback first, keep synchronous lifecycle work synchronous, and dispatch any awaited side work from a guarded helper. Iterate `this.combatants`, guard empty/deleted combatants and Canvas state, and isolate the side-initiative behavior from the Document lifecycle override.

**Tests:** create/start/update/delete Combat, empty Combat, deleted combatant Token, next round/turn, non-viewed encounter, token markers, tracker refresh, Actor-sheet refresh, sound/turn events, and v13/v14 parity.

### SW-03 — High — Unlinked NPC Token HP rolls are not safely persisted

**Evidence:** [`module/tokens/token.mjs`](module/tokens/token.mjs#L1-L28).

The Token creation callback rolls HP and assigns `actor.system.hp.max` and `.value` directly. `system` is prepared Document data; direct assignment is not a supported persistent mutation and may disappear on preparation, refresh, or reload. In a world with multiple active GMs, every GM client also runs this callback and can produce a different roll.

The code also assumes `actor` and `actor.system.hd` exist and constructs a formula without validating it.

**Recommended fix:** Select one authority, parse and validate the HD formula, then `await` an update to the synthetic Token Actor using documented Document APIs. Record or display the rolled result and fail without changing the Token when the formula is invalid.

**Tests:** unlinked NPC creation and reload, linked NPC, missing/invalid HD, `1`, `2d6`, `3+1`, `3-1`, multiple GMs, and update failure.

### SW-04 — High — A feature with no formula causes infinite recursion

**Evidence:** [`module/item/item.mjs`](module/item/item.mjs#L76-L116).

In `roll()`, an empty-formula `feature` falls through to the `spell` case and calls `post()`. Because the Item is not a spell, `post()` calls `roll()` again. The cycle continues until the call stack or promise chain fails.

**Recommended fix:** Give the empty-formula feature path an explicit outcome. Posting its description to chat is consistent with ordinary Items; alternatively return a structured validation failure. Do not rely on switch fall-through.

**Tests:** feature with a valid formula, blank formula, whitespace formula, invalid formula, and description-only feature.

### SW-05 — High — Combat HUD spell casting bypasses the safe casting service

**Evidence:** [`module/hud/hud.mjs`](module/hud/hud.mjs#L83-L96).

The HUD calls `item.roll()` and then splices `actor.system.spellSlots[level].memorized` and the derived `memorizedSpells` collection directly. Those changes are not persisted. This bypasses the Spell Effects service's authorization, prepared-slot validation, cast lock, message/consumption audit, and awaited Actor update.

**Recommended fix:** Replace the entire mutation block with `await item.cast()`, handle the returned status using the same UI helper as the Actor and Item sheets, and allow the resulting Actor update hook to rerender the HUD.

**Tests:** cast from HUD consumes exactly one prepared copy, survives reload, double-click, failed chat creation, failed Actor update, player-owned Actor, and spell prepared more than once.

### SW-06 — High — Legacy weapon damage loses source/target identity

**Evidence:** [`module/helpers/overrides.mjs`](module/helpers/overrides.mjs#L30-L49), [`module/rolls/rolls.mjs`](module/rolls/rolls.mjs#L60-L121), and [`module/item/item.mjs`](module/item/item.mjs#L49-L69).

The attack roll correctly captures target snapshots, but the later damage roll ignores them and reads `game.user.targets` again. A user can change targets between attack and damage; damage and manual-apply buttons then operate on actors which were never hit. The damage-button listener also calls `game.actors.get(actorId)` and immediately dereferences `actor.type`. An unlinked Token ID is not a world Actor ID, so the documented broken branch throws before it can recover the synthetic Actor or Item.

The automatic path uses `forEach(async ...)`, so callers do not await the HP mutations or receive their failures.

**Recommended fix:** Put the source Item UUID and immutable hit-target UUIDs in the attack message flags. Resolve both immediately before the damage roll, reject stale/unauthorized sources, and carry the same target snapshot into the damage message and application service. Use `for...of` or `Promise.all` only after the authoritative service is safe to run concurrently.

**Tests:** changed target selection, no current targets, linked Actor, unlinked Token Actor, deleted source Item, moved Token/Scene, multiple hit targets, and rejected mutation.

### SW-07 — Medium — Spell Effects locks are process-local, not multi-client concurrency control

**Evidence:** [`module/spells/application.mjs`](module/spells/application.mjs#L104-L225) and [`module/spells/service.mjs`](module/spells/service.mjs#L53-L115).

Spell Effects has deterministic application IDs and in-memory locks, which handle repeated clicks on one client and sequential retries well. The lock sets are not shared between clients. Two GMs can read the same unapplied message and HP value before either update is visible, and two owner clients can cast the same final prepared spell concurrently. The HP update and message audit are also two separate writes; rollback restores the earlier HP value without checking whether another legitimate mutation happened in between.

This is a residual race, not the open authorization failure present in the legacy RPC.

**Recommended fix:** Serialize shared applications through one active authority and add optimistic concurrency. Bind the application to an expected message revision and expected current HP (or an equivalent target-state fingerprint), reject stale writes, and never roll back over a newer revision. Apply the same principle to prepared-slot consumption.

**Tests:** two GM clients applying the same result simultaneously, GM plus automatic application, two owner clients casting the last prepared copy, unrelated HP update between mutation and audit failure, and authority change during a request.

### SW-08 — High — The stat-block importer can fail silently and leave orphan world Items

**Evidence:** [`module/importer/importer.mjs`](module/importer/importer.mjs#L76-L143) and [`module/importer/importer.mjs`](module/importer/importer.mjs#L176-L235).

The form handler is not async and does not await `importStatBlockText`, so its `try/catch` cannot catch asynchronous errors and the form closes before completion. Attacks are first created as world Items, then copied to the new Actor and deleted inside an unawaited `forEach(async ...)`. A parse, Actor-create, embed, or delete failure can leave partial Actors and temporary world Items behind.

The parser also dereferences missing fields (`block.xp.split`, `attackString.split`) before validation. Its string regular expression is not bounded by the next field label, so common stat blocks can capture several following fields as one value. HD subtraction such as `1-1` is not handled when calculating attack/save values.

**Recommended fix:** Parse into a strictly validated plain-data plan before creating any Document. Build attack Item source objects without creating world Items, then create the Actor with embedded Items or use one awaited embedded-document call. Keep the dialog open and display a localized, field-specific error on failure.

**Tests:** representative stat-block fixtures, optional/missing fields, reordered labels, `HD 1-1`, multiple attacks, punctuation, malformed damage, Actor/embed failure, and proof that failure creates no world or embedded Documents.

### SW-09 — Medium — Data-model constraints contain misspelled options

**Evidence:** [`module/item/item-model.mjs`](module/item/item-model.mjs#L24-L39) and [`module/actor/actor-model.mjs`](module/actor/actor-model.mjs#L113-L130).

`quantity` and `weight` use `minimum: 0`, but Foundry v13/v14 `NumberField` uses `min`. Negative values are therefore not constrained as intended. Character level uses `intitial` instead of `initial`, so a new character does not receive the intended default from this field definition.

Related calculation/update edge cases exist in [`module/actor/actor.mjs`](module/actor/actor.mjs#L78-L120) and [`module/actor/actor.mjs`](module/actor/actor.mjs#L181-L199): quantity zero is treated as one by `Number(quantity) || 1`, and changing `tHAACB` to the valid value zero does not synchronize `tHAC0` because the check is based on truthiness.

**Recommended fix:** Correct the field options, explicitly choose `nullable` behavior, and use property-presence checks rather than truthiness in partial updates. Add a versioned, idempotent migration only if existing invalid or missing source values must be repaired.

**Tests:** schema clean/validate for negative, zero, blank, null, and missing values; new character defaults; quantity-zero encumbrance; and both directions of AC/to-hit synchronization including zero.

### SW-10 — Medium — Save and morale rolls do not carry a reliable Actor context

**Evidence:** [`module/actor/actor.mjs`](module/actor/actor.mjs#L138-L179) and [`module/rolls/rolls.mjs`](module/rolls/rolls.mjs#L162-L242).

`rollSave()` and `rollMorale()` pass the Actor itself as Roll data, while the renderers later read `this.data.actor`. That property is absent, so `ChatMessage.getSpeaker({actor: this.data.actor})` cannot identify the intended Actor. The non-GM morale branch dereferences `this.data.actor.id` and can throw. Even if that were corrected, the RPC receiver has no `moraleRoll` implementation, so the request currently does nothing.

The same speaker problem affects `AttackRoll`: its `data.actor` is a plain roll-data object, not the Actor Document required by `ChatMessage.getSpeaker`.

**Recommended fix:** Keep serializable roll data separate from a stable source Actor/Token UUID, resolve the Document for message creation, and define an explicit authority/visibility contract for morale rolls. Avoid putting live Document instances inside serialized Roll data.

**Tests:** roll from Actor sheet with no controlled Token, linked and unlinked Token, assigned character, GM/player morale visibility, missing/deleted Actor, and serialized chat-message reload.

### SW-11 — Medium — Combat HUD lifecycle and multi-selection handling are unstable

**Evidence:** [`module/hud/hud.mjs`](module/hud/hud.mjs#L39-L130).

There are two `title` getters; the first is unreachable. `_onRender` attaches fresh jQuery handlers on every render without removing or namespacing prior handlers and does not call the parent lifecycle method. Repeated rerenders can therefore duplicate actions depending on whether ApplicationV2 reuses the root element.

`activateHud` loops through existing HUDs but tests `controlled.includes(token)` instead of `controlled.includes(hud.token)`. With multiple controlled Tokens, it can retain or close the wrong HUD. HUD instances are stored by adding an ad hoc mutable `combatHuds` property to the User Document.

**Recommended fix:** Use ApplicationV2 declared actions/delegated handlers, one module-owned `Map<TokenUUID, CombatHud>`, one title getter, balanced lifecycle calls, and compare each HUD's token against the controlled set.

**Tests:** repeated render, update hook bursts, select/deselect two Tokens in both orders, Token deletion, Scene change, close/reopen, and listener/HUD counts after teardown.

### SW-12 — Medium — Active Effect creation uses the v13 schema on v14

**Evidence:** [`module/helpers/effects.mjs`](module/helpers/effects.mjs#L6-L33).

The helper creates effects using `icon` and `duration.rounds`. In Foundry 13, `icon` is a deprecated shim for `img`; in Foundry 14 the shim is gone. Foundry 14 also replaced `duration.rounds` with `duration.value`, `duration.units`, and expiry/start fields. A requested one-round temporary effect therefore is not represented by the v14 schema.

The edit/delete/toggle actions also assume the requested embedded effect still exists.

**Recommended fix:** Add one small generation adapter which emits public v13 or v14 Active Effect source data, use `img`, and handle stale IDs. Record and test the exact v14 duration semantics instead of silently discarding the duration.

**Tests:** create/edit/toggle/delete passive, inactive, and one-round effects on both core generations; reload; expired effect; stale effect ID; and console deprecation assertions.

### SW-13 — Medium — Character creation has an unclear permission contract and unhandled errors

**Evidence:** [`module/character-creator/character-creator.mjs`](module/character-creator/character-creator.mjs#L3-L25) and [`module/character-creator/character-creator.mjs`](module/character-creator/character-creator.mjs#L60-L92).

The character-creator button is added for every user, unlike the GM-only importer. Creation uses the legacy `permission` field with `default: 3` rather than the v13/v14 `ownership` field. Depending on compatibility handling, that is either ignored or requests owner-level access for every user; neither result expresses a safe product rule. The submit handler also does not await `createCharacter`, so creation errors are not reported before the dialog closes.

**Recommended fix:** Decide whether character creation is GM-only or player self-service, enforce that at the creation boundary, use `ownership` with explicit user IDs, validate name/folder, await the operation, and display localized errors.

**Tests:** GM, trusted player, ordinary player, no Actor-create permission, selected folder permission, blank/long name, create failure, and resulting ownership map.

### SW-14 — Medium — The release gate does not execute Playwright and legacy code is largely untested

**Evidence:** [`package.json`](package.json#L5-L20) and the current [`tests`](tests) tree.

`npm run check` calls `check:e2e`, which runs `playwright test --list`; `npm run package` calls that same check. A package can therefore be produced without launching Foundry or a browser. There is no checked-in CI workflow. All current Node and browser tests focus on Spell Effects; none directly import the Combat, HUD, legacy RPC/damage, importer, character creator, Token, or general roll classes.

Existing [`docs/compatibility-runs/2026-08-28-spell-cards.md`](docs/compatibility-runs/2026-08-28-spell-cards.md) evidence is useful and records passing v13/v14 Spell Effects tests, but it is feature-specific rather than a system-wide compatibility gate.

**Recommended fix:** Keep fast `check` and packaging tasks if desired, but add an explicit release-candidate command/CI job which builds one allowlisted artifact and runs it against both portable Foundry generations. Extend the diagnostic and Playwright matrix in remediation order, starting with SW-01 through SW-06.

### SW-15 — Low — Localization, accessibility, and route-prefix support are inconsistent

**Evidence:** [`module/settings.mjs`](module/settings.mjs#L4-L42), [`module/hud/hud.hbs`](module/hud/hud.hbs#L1-L70), [`module/importer/importer.mjs`](module/importer/importer.mjs#L9-L24), and [`module/scss/utils/_typography.scss`](module/scss/utils/_typography.scss#L1-L31).

The new Spell Effects UI is localized and mostly uses native buttons. Older settings, importer/creator UI, combat messages, HUD labels, notices, and macro notices contain hard-coded English. Several older interactive controls are anchors without `href`, keyboard activation, or an accessible button name. Asset/font URLs beginning with `/systems/...` can fail when Foundry is hosted under a route prefix.

**Recommended fix:** Move user-visible strings into `lang/*.json`, replace action anchors with buttons, add visible focus and accessible names, and use package-relative `systems/swords-wizardry/...` URLs. Add keyboard and non-root-route checks.

### SW-16 — Low — Repository and release hygiene can be tightened

**Evidence:** [`release-files.json`](release-files.json#L1-L34), [`module/tokens/token.mjs~`](module/tokens/token.mjs~), and [`module/scss/swords-wizardry.scss`](module/scss/swords-wizardry.scss#L1-L25).

The explicit release allowlist is a good control and correctly excludes tests, the tracked source map, and `token.mjs~`. The backup file and stale source map should nevertheless not be tracked. The release currently includes the entire `docs/` tree, including internal architecture, local-review, and compatibility-run notes. It also packages 4,149 game-icon SVGs (about 7.1 MB uncompressed) while runtime source directly references seven; the current ZIP is about 4.2 MB.

The stylesheet imports Google Roboto but uses bundled Libre Baskerville as its primary font, causing an unnecessary external request. It also contains global `body`, `input`, and generic utility selectors which can affect core or module UI.

**Recommended fix:** Remove editor backups/source maps from tracking, decide which documentation is truly end-user release content, remove the unused web-font import, scope system styling, and reduce packaged icons only after checking world/compendium references so user content is not broken.

## Recommended remediation order

1. **Close the mutation boundary:** replace the legacy RPC and bring weapon damage onto the validated, single-authority application path.
2. **Restore core correctness:** repair the Combat lifecycle override, Token HP persistence, empty-feature recursion, and HUD casting.
3. **Stabilize identity and concurrency:** use source/target UUID snapshots for weapons and add cross-client stale-state protection to spell/weapon application and spell consumption.
4. **Make creation tools transactional:** rewrite the importer around validated plain data, then define and enforce character-creator ownership.
5. **Repair v13/v14 contracts:** correct field definitions and add a generation adapter for Active Effect duration data.
6. **Expand release coverage:** add focused tests for each corrected defect, then run one release-shaped artifact through both Foundry generations with GM and player clients.
7. **Finish quality debt:** localization, keyboard controls, route-prefix-safe assets, logging cleanup, and repository/package trimming.

## Positive practices worth preserving

- [`module/spells/domain.mjs`](module/spells/domain.mjs) keeps validation and calculations deterministic and independent of Foundry globals.
- Spell card/result flags contain immutable source/action/target snapshots and stable UUIDs rather than current Canvas IDs.
- [`module/spells/application.mjs`](module/spells/application.mjs) validates message schema, action fingerprints, target membership, amount bounds, multipliers, and GM authority before applying HP.
- Spell HP changes are clamped, audited, and have an explicit rollback/unsafe result rather than silently claiming success.
- [`module/spells/action-editor.mjs`](module/spells/action-editor.mjs) preserves drafts, scroll position, focus, and validation errors across rerenders.
- The release is built from an allowlist rather than by zipping the repository wholesale.
- The project has real v13/v14 disposable-world evidence for the Spell Effects work, including GM/player Playwright runs and retained failure artifacts.

## Validation performed for this review

- Inventoried the runtime `.mjs` tree and performed a focused review of the permission, shared-mutation, persistence, lifecycle, roll, creation-tool, UI, and release paths relevant to the findings above.
- Compared version-sensitive findings with the installed Foundry 13.351 and 14.367 source, specifically `NumberField`, `Combat._onUpdate`, `ChatMessage.getSpeaker`, Roll data handling, and Active Effect schemas.
- Ran `npm run check`: JSON, localization, manifest, syntax, templates, Playwright test discovery, 57 Node tests, and CSS build all passed.
- Inspected the release allowlist, staged package shape, current test imports, and dated compatibility evidence.

No live world was modified and no real Foundry/Playwright run was started during this report-only review. Findings marked as concurrency or compatibility risks should be confirmed with the focused v13/v14 tests listed above before implementation choices are finalized.
