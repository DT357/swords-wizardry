# Spell-card guide

## Configure a Spell Item

The Spell sheet keeps the existing description, spell level, range, and
duration fields. It also provides a caster-level source and an ordered **Spell
Effects** list.

Caster-level sources are:

- **Automatic:** use an unambiguous character level; otherwise prompt.
- **Fixed:** use the explicit value stored on the Spell Item.
- **Prompt:** always ask when the card is posted or cast.
- **Character level:** require one integer character level; compound or missing
  values prompt rather than being guessed.
- **NPC hit dice:** require an explicit integer hit-die value. Challenge level
  is not used as a substitute.

Spell Effects support damage, healing, attack, general roll, rules-reference,
and description types. Each effect has a name and target mode; roll formulas,
saving throws, attack details, references, and notes appear only when they apply
to the selected type. Drag-free move controls keep effect order
keyboard-accessible. Internal stable IDs remain hidden from the editor.

## Formulas

Only these paths are available to a spell formula:

```text
@spell.level
@spell.casterLevel
@spell.abilityModifier
```

Examples:

```text
(@spell.casterLevel)d6
1d8 + @spell.casterLevel
1d20 + @spell.abilityModifier
```

An effect that references an unavailable ability modifier fails visibly; it is
not converted to zero. Formulas and numeric application amounts are bounded and
validated before use.

## Post and Cast

**Post** creates a spell card without changing prepared spells. **Cast** creates
the same card, then removes exactly one matching occurrence from the Actor's
prepared list. If a caster-level prompt is cancelled or the card cannot be
created, preparation is unchanged.

Each card stores a versioned snapshot of the Item name, description, level,
caster level, effects, source UUIDs, and initial target UUIDs. Editing the Item
afterward does not silently change an existing card.

## Resolve a Spell Effect

Select the required Tokens and activate an effect on the spell card. One-target
effects require exactly one selected target. Selected-target effects require at
least one. The result records the target UUIDs before the Roll begins and uses
that snapshot for attack and application results.

The current core roll mode is honored. A generation adapter applies v13 roll
modes through `ChatMessage.applyRollMode` and v14 visibility modes through
`ChatMessage.applyMode` before the message is created.

Damage and healing result cards show application controls to a GM. Half, full,
and double multipliers are supported. The service revalidates the stored effect,
result, target membership, target UUID, caller authority, amount, and multiplier
immediately before updating HP. Each effect/target pair has a deterministic ID,
so retries do not duplicate the change.

The **DM must apply damage / healing** world setting governs both damage and
healing Spell Effects. When checked, a GM chooses Damage, Half, or Double for
damage, or the corresponding healing amount, on the result card. When unchecked,
the active GM immediately applies the full rolled result to every captured target
and the manual application buttons are omitted. Automatic application requires an
active GM client.

## Deliberately manual procedures

The following remain table procedures in 4.2.0:

- target saving throws, magic resistance, and disbelief;
- duration countdown and ongoing or repeating damage;
- condition and Active Effect creation;
- summoned creatures and other world-document creation;
- complex projectile allocation or conditional branches.

Use Description effects and notes to put those instructions on the card without
claiming the system has automated them.

## Macro and module API

The stable entry point is `game.swordswizardry.spells`:

```js
const item = await fromUuid('Actor.actorId.Item.spellId');
await game.swordswizardry.spells.post(item);
await game.swordswizardry.spells.cast(item);
```

`post`, `cast`, and `invoke` return structured success, cancellation, or failure
results. `requestApplication` is GM-only and is intended for the system's result
cards rather than arbitrary macro-supplied values.

## Existing worlds

No bulk migration runs for this feature. Existing Spell Items retain their
description, level, range, and duration and receive empty effect/casting
defaults through the DataModel. Configure Spell Effects when useful. Unknown
future action or message schema versions fail closed instead of being rewritten.
