import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sheetSource = readFileSync(
  new URL('../../../module/actor/features.hbs', import.meta.url),
  'utf8'
);
const characterSheetSource = readFileSync(
  new URL('../../../module/actor/character-sheet.hbs', import.meta.url),
  'utf8'
);
const npcSheetSource = readFileSync(
  new URL('../../../module/actor/npc-sheet.hbs', import.meta.url),
  'utf8'
);
const cardSource = readFileSync(
  new URL('../../../module/rolls/ability-roll-sheet.hbs', import.meta.url),
  'utf8'
);
const saveCardSource = readFileSync(
  new URL('../../../module/rolls/save-roll-sheet.hbs', import.meta.url),
  'utf8'
);
const moraleCardSource = readFileSync(
  new URL('../../../module/rolls/morale-roll-sheet.hbs', import.meta.url),
  'utf8'
);
const resourceStyles = readFileSync(
  new URL('../../../module/scss/components/_resource.scss', import.meta.url),
  'utf8'
);
const messageStyles = readFileSync(
  new URL('../../../module/scss/components/_messages.scss', import.meta.url),
  'utf8'
);

test('attribute icon and name form one accessible roll button in visual order', () => {
  assert.match(
    sheetSource,
    /<button[\s\S]*?class="ability-roll-control[^"]*"[\s\S]*?data-action="abilityRoll"[\s\S]*?data-ability="{{key}}"[\s\S]*?<i class="fas fa-dice-d20"[^>]*><\/i>[\s\S]*?<span>{{ability\.label}}<\/span>[\s\S]*?<\/button>/
  );
  assert.match(resourceStyles, /\.ability-roll-control\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*flex-start;/);
});

test('save and morale headings are single no-wrap buttons containing their labels and icons', () => {
  assert.match(
    characterSheetSource,
    /<button[\s\S]*?class="[^"]*stat-roll-control[^"]*"[\s\S]*?data-action="saveRoll"[\s\S]*?<span>{{ localize 'SWORDS_WIZARDRY\.Stats\.SavingThrow\.abbr' }}<\/span>[\s\S]*?<i class="fas fa-dice-d20"[^>]*><\/i>[\s\S]*?<\/button>/
  );
  assert.match(
    npcSheetSource,
    /<button[\s\S]*?class="[^"]*stat-roll-control[^"]*"[\s\S]*?data-action="saveRoll"[\s\S]*?<span>{{localize 'SWORDS_WIZARDRY\.Stats\.SavingThrow\.long'}}<\/span>[\s\S]*?<i class="fas fa-dice-d20"[^>]*><\/i>[\s\S]*?<\/button>/
  );
  assert.match(
    npcSheetSource,
    /<button[\s\S]*?class="[^"]*stat-roll-control[^"]*"[\s\S]*?data-action="moraleRoll"[\s\S]*?<span>{{localize 'SWORDS_WIZARDRY\.Stats\.Morale'}}<\/span>[\s\S]*?<i class="fas fa-dice-d20"[^>]*><\/i>[\s\S]*?<\/button>/
  );
  assert.match(resourceStyles, /\.stat-roll-control\s*\{[\s\S]*?display:\s*inline-flex;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(resourceStyles, /\.stat-roll-control\s*>\s*\*,[\s\S]*?\.ability-roll-control\s*>\s*\*\s*\{[\s\S]*?pointer-events:\s*none;/);
});

test('threshold roll cards align target and theme-aware outcome in one shared row', () => {
  for (const source of [cardSource, saveCardSource, moraleCardSource]) {
    assert.match(source, /<article class="swords-wizardry [^"]*threshold-roll-card[^"]*">/);
    assert.match(source, /class="threshold-roll-card__result"/);
    assert.match(source, /class="threshold-roll-card__target"/);
    assert.match(source, /class="threshold-roll-card__outcome {{#if success}}is-success{{else}}is-failure{{\/if}}"/);
    assert.match(source, /{{#if success}}{{localize "SWORDS_WIZARDRY\.Chat\.Success"}}{{else}}{{localize "SWORDS_WIZARDRY\.Chat\.Failure"}}{{\/if}}/);
  }
  assert.match(messageStyles, /\.threshold-roll-card__result\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/);
  assert.match(messageStyles, /\.threshold-roll-card__outcome\s*\{[\s\S]*?margin-inline-start:\s*auto;[\s\S]*?font-weight:\s*bold;[\s\S]*?text-transform:\s*uppercase;/);
  assert.match(messageStyles, /&\.is-success\s*\{[\s\S]*?color:\s*var\(--color-level-success/);
  assert.match(messageStyles, /&\.is-failure\s*\{[\s\S]*?color:\s*var\(--color-level-error/);
});
