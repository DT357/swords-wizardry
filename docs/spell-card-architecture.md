# Spell-card architecture and security

The spell feature is divided into deterministic domain functions, Foundry
adapters, chat/application controllers, and the init composition root.

Item action data is bounded by the Spell DataModel and normalized again at every
untrusted boundary. Chat cards persist schema-versioned snapshots under
`flags.swords-wizardry.spell`; invocation never reconstructs behavior from
current Item state. Target UUIDs are captured before asynchronous Roll work and
re-resolved immediately before mutation.

The Foundry chat adapter converts legacy v13 public/GM/blind/self roll-mode
names to v14 visibility modes when `ChatMessage.applyMode` exists and otherwise
uses v13's `ChatMessage.applyRollMode`. The transient selector is removed before
strict ChatMessage creation.

Damage and healing application is intentionally local to a GM client. Foundry's
custom system socket transport does not supply an authenticated caller identity
to arbitrary payload handlers, so this implementation does not accept
player-authored mutation envelopes. Hidden controls are not treated as an
authorization boundary: the service checks the current user again before every
application.

Each application uses a deterministic message/action/target ID. The service
revalidates the message schema, action fingerprint, operation, target membership,
UUID, amount, and multiplier. It updates the target Actor and then writes an
audit entry to the ChatMessage. If the audit write fails it compensates the Actor
write; a failed compensation is reported as an unsafe state and never described
as restored.

Prepared-spell consumption is serialized per Actor/Item on one client and the
prepared list is re-read after card creation. Foundry does not expose a general
compare-and-swap Document update, so simultaneous casts from separate clients
remain a runtime concurrency risk. The normal UI ownership model and the GM-only
application boundary limit the impact, but multi-client runtime testing remains
required before release.
