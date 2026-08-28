# Game System for Swords & Wizardry

> Compatible with the Swords & Wizardry rules

![Foundry v13 and v14](https://img.shields.io/badge/foundry-v13%20%7C%20v14-green)

Swords & Wizardry, S&W, and Mythmere Games are trademarks of Mythmere Games LLC (mythmeregames.com).

The author is not affiliated in any way with Mythmere Games LLC.

## Contributors
- Tomasz Strasewski (@tomski80): Project founder
- Caz (@vonkow): Current author/maintainer
- René Kremer (@hadesrofl): Translation and German language support
- Javier García (@fragarco): Spanish language support
- Cussa Mitre (@Cussa): Bugfix
- Ben Menesini (@sayhiben): RCP fixes and more
- Juan Lucha (@JuanLucha): Encumbrance and movment calculations
- Dan (@DT357): DM applied damage feature and deprecation fixes
 
## Spell cards

Spell Items can define ordered, reusable **Spell Effects** for damage, healing,
attacks, other rolls, rules references, and descriptive instructions. The
editor shows only the options relevant to the selected effect type. Posting a
spell creates an immutable chat snapshot without spending preparation. Casting
posts the same card and removes exactly one prepared occurrence only after the
card is created.

Roll actions use an explicit, namespaced context: `@spell.level`,
`@spell.casterLevel`, and `@spell.abilityModifier`. Selected targets are captured
when an effect begins so later selection changes cannot redirect a result.
Damage and healing results can be applied by a GM, are clamped to valid HP
bounds, and record an idempotent audit entry on the result card. When **DM must
apply damage / healing** is unchecked, both kinds of Spell Effect immediately
apply their full roll to each captured target through the active GM.

Saving throws, magic resistance, disbelief, durations, ongoing damage, summoned
creatures, and Active Effects remain explicit table procedures in this release.

See [the spell-card guide](docs/spell-cards.md) for setup, use, limitations, and
the public macro API.

## Documentation

End-user documentation can be found [here](documentation.md). Developer setup,
testing, packaging, the runtime diagnostic, and the safety-gated Playwright
GM/player suite are documented in
[docs/development.md](docs/development.md).

## Languages

 - English
 - German (by René Kremer)
 - Spanish (by Javier García)
 
## Legal

1. **Notice.** This work includes AELF Open Gaming Content, which may only be used under the terms of the AELF Open License version 1.0a. This product is not endorsed or reviewed by Mythmere Games LLC or any other contributor of AELF Open Gaming Content and does not represent the views of Mythmere Games LLC any other contributor.
2. With the exception of the material designated as Product Identity, this entire work is designated as AELF Open Game Content.
3. Mythmere Games LLC is designated as Product Identity, along with the Swords & Wizardry, S&W, and Mythmere Games. The author is not affiliated with Mythemere Games LLC.
4. **Attributions.**
  a. This work includes material from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at: https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at: https://creativecommons.org/licenses/by/4.0/legalcode.
  b. This work includes artwork from https://game-icons.net. This art is licensed under the Creative Commons Attribution 3.0 International License available at: https://creativecommons.org/licenses/by/3.0/legalcode.
