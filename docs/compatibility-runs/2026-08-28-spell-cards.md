# Spell-card compatibility run — 2026-08-28

Candidate: Swords & Wizardry 4.2.0 release-shaped local review build.

## Environment and safety

- Portable cores: Foundry v13 build 351 and v14 build 367.
- Server runtime: Node.js 24.15.0, bound to localhost only.
- Browser runner: Playwright 1.62.1 with its pinned Chromium build.
- Isolated data roots: `RuntimeTests/v13` and `RuntimeTests/v14`, outside the
  package repository and separate from both portable installations' existing
  `Data` directories.
- Disposable worlds: `sw-spell-cards-v13` and `sw-spell-cards-v14`.
- Package shape: staged `dist/swords-wizardry` output, not a source symlink.
- Clients: one Gamemaster and one ordinary player in separate browser contexts.

The diagnostic safety gate required `SW_FOUNDRY_DISPOSABLE_WORLD=YES` and an
exact running-world ID match. It created only `[SW Spell Diagnostic]` fixtures
and removed their ChatMessages, Scene, Token, and Actors after each run. The
portable installations' pre-existing worlds and data were not opened or
modified.

## Results

| Core build | System | Diagnostic | Playwright GM/player | Result |
| --- | --- | --- | --- | --- |
| 13.351 | 4.2.0 | 13/13 checks passed | 2/2 tests passed | Pass |
| 14.367 | 4.2.0 | 13/13 checks passed | 2/2 tests passed | Pass |

The real-Foundry diagnostic covered system DataModels, owned spell Items,
prepared Post/Cast behavior, an inactive Scene, an unlinked Token and synthetic
Actor, public/GM/blind/self visibility, target snapshots, damage and healing
clamping, duplicate application idempotency, and retained player ownership.

The Playwright gate covered the ApplicationV2 Spell Effects editor, progressive
type-specific fields, unsaved draft retention, effect persistence after saving
and reopening, add-effect focus, keyboard activation, an 800 by 600 constrained
viewport, Post versus Cast consumption, player-owned invocation, direct non-GM
application rejection, hidden player application controls, GM HP application,
diagnostic cleanup, and browser console/page/network evidence.

## Manual-test persistence follow-up

Manual review found that saving Spell Effects closed the editor without
persisting its rows. Both supported cores expose `FormDataExtended.object` with
dotted field names, while the handler incorrectly read an already-expanded
`actions` property. A browser regression first reproduced the failure, then
verified the corrected handler by saving changed and newly added rows, reading
the updated Item, reopening the editor, and checking the persisted values. The
focused GM regression passed first, followed by the complete 2/2 GM/player
Playwright suite against the final release-shaped candidate on both v13.351 and
v14.367.

## Spell Effects editor follow-up

The player-facing feature was renamed from Actions to Spell Effects without
changing `system.actions` or the versioned chat-message schema. The editor now
shows only the fields relevant to each selected effect type and clears stale,
irrelevant values when the type changes. A deterministic visibility test covers
all six effect types. The browser test covers the localized sheet heading,
add-effect flow, immediate type switching, conditional custom-attack guidance,
constrained layout, persistence, and reopening. The complete 2/2 GM/player
Playwright suite passed for the release-shaped candidate on both v13.351 and
v14.367, and all static, unit, integration, template, and packaging checks
passed with 45 Node tests.

## Weapon-style damage-card follow-up

Damage-type Spell Effect results now reuse the weapon damage card's outlined
target, target-name, compact button-row, and button classes. The spell card
retains its existing full, half, and double application behavior, while the
visible labels match the weapon card's compact `Damage`, `Half`, and `Double`
wording. Full action labels remain available to assistive technology. Healing,
attack, roll, reference, and description result layouts are unchanged.

A Node rendering regression verifies that the weapon-card classes appear only
on damage results. The browser gate verifies the real computed border, Libre
Baskerville font, flex controls, 11-pixel button text, compact labels, keyboard
activation, and applied-result status. The final release-shaped candidate
passed all 47 Node tests and the complete 2/2 GM/player Playwright suite on both
v13.351 and v14.367.

During the v13 rerun, the test-only diagnostic exposed an unstable assumption
that Foundry returns newly created embedded Items in input order. The diagnostic
now identifies its damage and healing fixtures by their persisted effect kind;
no release runtime behavior changed. Both clean post-fix compatibility runs
passed 2/2 in a single run.

## Theme-aware typography follow-up

Foundry's global definition-list styling supplied spell metadata labels with a
theme-specific foreground and a black text shadow. That styling was designed
for core dark surfaces, not a system chat card, and became difficult to read on
the default light card and under dark chat-skin modules.

Spell-card titles, headings, paragraphs, metadata, and emphasized labels now
inherit the active chat message's foreground color and explicitly remove text
shadows. Metadata labels use regular weight; button colors remain owned by the
active UI theme while their text shadows are removed. A real-DOM Playwright
assertion applies a dark host foreground and verifies inherited computed colors,
shadow removal, and metadata weight on both supported core generations.

## Per-result application-state follow-up

Manual testing found that a new damage or healing result could display the
applied status from an earlier result and omit its application buttons. The
application service and chat renderer now accept an applied entry only when its
application ID was derived from the current result message UUID, action, and
target. Foreign entries are ignored during rendering and removed when the new
result is applied. Duplicate clicks on the same result remain idempotent.

Integration regressions reproduce the defect by copying an applied entry from
one result into another. The browser gate performs the same fault injection in
real Foundry, verifies that the new result retains its buttons, applies it, and
confirms that only the new result's audit entry remains.

## Evidence and known environment noise

Passing screenshots and the Foundry server logs are retained under the local
`RuntimeTests/v13/Evidence` and `RuntimeTests/v14/Evidence` directories. The
checked-in Playwright report is regenerated per run and remains excluded from
the release archive.

The only server warnings were failed offline core/system update checks and IP
discovery. The constrained-viewport test intentionally triggers Foundry's exact
minimum-resolution console message; the evidence filter allowlists only that
message. The test runner fulfills the external Google Fonts stylesheet with an
empty local response so restricted network access cannot obscure product
failures. No Swords & Wizardry console errors, page errors, failed local
requests, or deprecation warnings were observed in either passing run.

## Compatibility conclusion

The tested release-shaped 4.2.0 candidate supports Foundry v13.351 and v14.367
for the spell-card flows above. `system.json` retains minimum generation 13 and
advances `compatibility.verified` to 14.367. This run does not claim coverage
for untested older v13 builds or future v14 builds.
