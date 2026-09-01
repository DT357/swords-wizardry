import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const combatTemplate = readFileSync(
  new URL('../../../module/actor/weapons.hbs', import.meta.url),
  'utf8'
);
const equipmentTemplate = readFileSync(
  new URL('../../../module/actor/items.hbs', import.meta.url),
  'utf8'
);
const itemStyles = readFileSync(
  new URL('../../../module/scss/components/_items.scss', import.meta.url),
  'utf8'
);

test('combat and equipment tables use one separator per column boundary', () => {
  assert.match(itemStyles, /> \* \+ \* \{[\s\S]*?border-inline-start:/u);
  assert.match(itemStyles, /\.item > \* \{[\s\S]*?border: 0;/u);
  assert.doesNotMatch(combatTemplate, />\s*\|\s*</u);
  assert.doesNotMatch(equipmentTemplate, />\s*\|\s*</u);
});

test('equipment quantity controls share one horizontal row', () => {
  assert.match(equipmentTemplate, /class='item-prop item-quantity'/u);
  assert.match(equipmentTemplate, /class='item-quantity__value'/u);
  assert.match(itemStyles, /\.item-quantity \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/u);
});

test('combat and equipment item rows use symmetrical vertical spacing', () => {
  assert.match(
    itemStyles,
    /&\.columnar-items-list\s*\{[\s\S]*?\.item:not\(\.items-header\)\s*\{[\s\S]*?margin-block:\s*0;[\s\S]*?padding-block:\s*6px;/u
  );
  assert.match(
    itemStyles,
    /&\.columnar-items-list\s*\{[\s\S]*?\.item-name-span,[\s\S]*?\.item-controls button\s*\{[\s\S]*?margin-top:\s*0;/u
  );
});
