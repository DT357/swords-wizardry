import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const templatePaths = [
  '../../../module/rolls/ability-roll-sheet.hbs',
  '../../../module/rolls/save-roll-sheet.hbs',
  '../../../module/rolls/morale-roll-sheet.hbs',
  '../../../module/rolls/feature-roll-sheet.hbs',
  '../../../module/templates/items/item-card.hbs',
  '../../../module/templates/weapons/attack-result.hbs',
  '../../../module/templates/weapons/damage-result.hbs',
  '../../../module/templates/spells/spell-card.hbs',
  '../../../module/templates/spells/action-result.hbs'
];
const messageStyles = readFileSync(
  new URL('../../../module/scss/components/_messages.scss', import.meta.url),
  'utf8'
);

test('every primary system chat-card title uses the reduced shared title style', () => {
  for (const path of templatePaths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /<h3 class="chat-card__title">/u, path);
  }
  assert.match(messageStyles, /\.chat-card__title\s*\{[\s\S]*?font-size:\s*1rem;/u);
});
