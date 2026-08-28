import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Handlebars from 'handlebars';

const templateSource = readFileSync(
  new URL('../../../module/templates/spells/action-result.hbs', import.meta.url),
  'utf8'
);
const systemStylesSource = readFileSync(
  new URL('../../../module/scss/swords-wizardry.scss', import.meta.url),
  'utf8'
);
const spellStylesSource = readFileSync(
  new URL('../../../module/scss/components/_spells.scss', import.meta.url),
  'utf8'
);

Handlebars.registerHelper('eq', (left, right) => left === right);
Handlebars.registerHelper('or', (...values) => values.slice(0, -1).some(Boolean));
Handlebars.registerHelper('localize', (key) => key.split('.').at(-1));

const render = Handlebars.compile(templateSource);

test('damage spell results reuse the weapon damage card layout classes', () => {
  const html = render(resultContext('damage'));

  assert.match(html, /class="spell-result__targets damage-targets"/);
  assert.match(html, /class="spell-result__target damage-target"/);
  assert.match(html, /class="spell-result__target-name target-name"/);
  assert.match(html, /class="spell-result__application-controls damage-buttons"/);
  assert.equal((html.match(/class="apply-damage"/g) ?? []).length, 3);
  assert.match(html, />Damage<\/button>/);
  assert.match(html, />Half<\/button>/);
  assert.match(html, />Double<\/button>/);
});

test('non-damage spell results retain the spell result layout', () => {
  const html = render(resultContext('healing'));

  assert.doesNotMatch(html, /damage-targets|damage-target|damage-buttons|apply-damage/);
  assert.match(html, /class="spell-result__application-controls"/);
});

test('spell-card typography inherits the chat theme without core text shadows', () => {
  assert.match(
    systemStylesSource,
    /\.swords-wizardry\.spell-card\s*\{[\s\S]*?&,[\s\S]*?h3,[\s\S]*?h4,[\s\S]*?p,[\s\S]*?dt,[\s\S]*?dd,[\s\S]*?strong\s*\{[\s\S]*?color:\s*inherit;[\s\S]*?text-shadow:\s*none;/
  );
  assert.match(
    spellStylesSource,
    /&__metadata\s*\{[\s\S]*?dt\s*\{[\s\S]*?font-weight:\s*400;/
  );
  assert.match(
    systemStylesSource,
    /\.swords-wizardry\.spell-card\s*\{[\s\S]*?button\s*\{[\s\S]*?text-shadow:\s*none;/
  );
});

function resultContext(kind) {
  return {
    rollHTML: '<span>6</span>',
    spell: {
      item: { name: 'Test Spell', img: '' },
      action: {
        kind,
        label: 'Test Effect',
        save: { notes: '' },
        attack: { notes: '' },
        effect: { reference: '' },
        notes: ''
      },
      result: { formula: '1d6' },
      targets: [{ uuid: 'Actor.target', name: 'Target', status: 'resolved' }]
    }
  };
}
