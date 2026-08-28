# CHANGELOG

## 4.2.0 - Unreleased

- Add configurable, ordered Spell Effects to Spell Items.
- Add separate Post and Cast workflows with one-occurrence prepared-spell
  consumption and visible failure auditing.
- Add immutable, versioned spell and action-result chat cards.
- Add bounded spell formulas with explicit caster-level resolution.
- Add stable target snapshots for spell and weapon attacks.
- Add GM-authoritative, idempotent damage and healing application with HP
  clamping and rollback when the audit write fails.
- Add English, German, and Spanish spell-card localization and accessible,
  responsive spell controls.
- Present Spell Effects with only the fields relevant to the selected effect
  type while preserving the existing internal schema and runtime behavior.
- Fix the Spell Effects editor so saving persists dotted ApplicationV2 form
  fields and survives closing and reopening the Spell Item.
- Match damage-type Spell Effect result targets and controls to the established
  weapon damage card layout, typography, and compact button labels.
- Make spell-card text inherit the active chat theme, remove decorative text
  shadows, and use regular-weight metadata labels for light and dark UIs.
- Scope applied damage and healing state to its originating result message so
  a new casting always receives fresh application controls.
- Add unit/integration tests, static contract checks, a release allowlist,
  reproducible packaging, a self-cleaning Foundry diagnostic module, and a
  safety-gated Playwright GM/player suite.
- Verify the release-shaped candidate on Foundry v13.351 and v14.367 with GM
  and ordinary-player clients.
- Existing Spell Items receive schema defaults when loaded; no bulk world
  migration is performed.

## 1.2.0

- Add support for Foundry v10
