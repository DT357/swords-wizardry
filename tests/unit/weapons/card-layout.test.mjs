import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Handlebars from 'handlebars';

const attackCardSource = readFileSync(
  new URL('../../../module/templates/weapons/attack-result.hbs', import.meta.url),
  'utf8'
);
const damageCardSource = readFileSync(
  new URL('../../../module/templates/weapons/damage-result.hbs', import.meta.url),
  'utf8'
);
const messageStyles = readFileSync(
  new URL('../../../module/scss/components/_messages.scss', import.meta.url),
  'utf8'
);

Handlebars.registerHelper('eq', (left, right) => left === right);
Handlebars.registerHelper('localize', (key) => ({
  'SWORDS_WIZARDRY.Spell.Card.AttackOutcome.hit': 'Hit',
  'SWORDS_WIZARDRY.Spell.Card.AttackOutcome.miss': 'Miss',
  'SWORDS_WIZARDRY.Spell.Card.MissingTarget': 'Target is no longer available'
})[key] ?? key);

const renderAttack = Handlebars.compile(attackCardSource);

test('weapon card icon and heading share one aligned header row', () => {
  for (const source of [attackCardSource, damageCardSource]) {
    assert.match(source, /<header class="item-card__header weapon-card__header">[\s\S]*?<img[\s\S]*?<h3 class="chat-card__title">[\s\S]*?<\/h3>[\s\S]*?<\/header>/);
  }
  assert.match(messageStyles, /\.item-card__header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/);
  assert.match(messageStyles, /\.item-card__header h3\s*\{[\s\S]*?margin:\s*0;/);
});

test('weapon damage target numbering is inside its outlined target row', () => {
  assert.match(damageCardSource, /<ol class="weapon-card__targets damage-targets">[\s\S]*?<li class="damage-target"/);
  assert.match(messageStyles, /\.weapon-card__targets\.damage-targets\s*\{[\s\S]*?padding-inline-start:\s*0;/);
  assert.match(messageStyles, /\.damage-target\s*\{[\s\S]*?list-style-position:\s*inside;/);
});

test('weapon attack targets show a bold name followed by localized Hit! or Miss!', () => {
  const html = renderAttack({
    rollHTML: '<span>12</span>',
    weapon: {
      item: { name: 'Club', img: '' },
      targets: [
        { name: 'Ogre', outcome: 'hit' },
        { name: 'Goblin', outcome: 'miss' }
      ],
      hitTargetUuids: [],
      damageFormula: '1d6'
    }
  });

  assert.match(html, /<li><strong class="weapon-card__target-name">Ogre<\/strong>:\s*<span class="weapon-card__target-outcome">Hit!<\/span><\/li>/u);
  assert.match(html, /<li><strong class="weapon-card__target-name">Goblin<\/strong>:\s*<span class="weapon-card__target-outcome">Miss!<\/span><\/li>/u);
});
