import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cardSource = readFileSync(
  new URL('../../../module/rolls/feature-roll-sheet.hbs', import.meta.url),
  'utf8'
);

test('feature card always renders an icon, title, and enriched description', () => {
  assert.match(cardSource, /<article class="swords-wizardry [^"]*feature-card[^"]*">/);
  assert.match(cardSource, /<header class="item-card__header feature-card__header">[\s\S]*?<img[^>]*src="{{item\.img}}"[\s\S]*?<h3 class="chat-card__title">{{item\.name}}<\/h3>[\s\S]*?<\/header>/);
  assert.match(cardSource, /<div class="feature-card__description">{{{description}}}<\/div>/);
});

test('rollable feature card uses the shared threshold result row', () => {
  assert.match(cardSource, /{{#if roll}}[\s\S]*?class="inline-result"[\s\S]*?{{{roll}}}/);
  assert.match(cardSource, /class="threshold-roll-card__result"/);
  assert.match(cardSource, /class="threshold-roll-card__target"/);
  assert.match(cardSource, /class="threshold-roll-card__outcome {{#if success}}is-success{{else}}is-failure{{\/if}}"/);
  assert.match(cardSource, /{{#if success}}{{localize "SWORDS_WIZARDRY\.Chat\.Success"}}{{else}}{{localize "SWORDS_WIZARDRY\.Chat\.Failure"}}{{\/if}}/);
});
