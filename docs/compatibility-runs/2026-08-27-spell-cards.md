# Spell-card compatibility run — 2026-08-27

> Superseded by the completed
> [2026-08-28 runtime matrix](2026-08-28-spell-cards.md). This file preserves
> the earlier pending-run state.

Candidate: Swords & Wizardry 4.2.0, uncommitted local review build.

## Automated checks

The final local non-Foundry gate passed with 44 Node unit/integration tests,
335-key localization parity across three locales, JSON and manifest checks,
syntax checks for 44 JavaScript modules, discovery of two Playwright GM/player
tests, parsing of 21 Handlebars templates, and
a warning-free Sass build. `npm audit` reported zero vulnerabilities.

Packaging produced a 4,216-file release archive with one root `system.json`, no
forbidden development paths, and SHA-256 checksums. The staged manifest, entry
module, and stylesheet matched the files installed into the local Foundry data
directory. The prior 4.1.0 install was moved to a timestamped recoverable backup.

## Foundry runtime matrix

| Core build | Package | Clients | Status |
| --- | --- | --- | --- |
| v13 | staged 4.2.0 | GM + player | Not run in this workspace yet |
| 14.365 | staged 4.2.0 | GM + player | Installed; authenticated disposable-world run pending |

Foundry 14.365 launched successfully and served the setup client locally. The
existing administrator-password gate prevented unattended world creation; no
credential was inspected or reset and no existing world was opened. Foundry v13
is not installed in this workspace. Therefore neither matrix row is a completed
runtime compatibility result yet.

The checked-in Playwright suite refuses to run unless the disposable-world
safety flag, exact world ID, and GM/player inputs are supplied. Add its
diagnostic report, console/network errors, artifacts, and screenshots after the
authenticated run. Do not treat
the automated Node checks or successful package discovery as runtime
compatibility proof.
