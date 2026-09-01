import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const template = readFileSync(
  new URL('../../../module/hud/hud.hbs', import.meta.url),
  'utf8'
);
const styles = readFileSync(
  new URL('../../../module/scss/components/_apps.scss', import.meta.url),
  'utf8'
);

test('HUD keeps compact semantic controls and excludes description-only features', () => {
  assert.match(template, /\{\{#if feature\.system\.formula\}\}/u);
  assert.match(template, /<button type="button" data-action="item"/u);
  assert.match(styles, /\.combat-hud \{[\s\S]*?font-size:/u);
  assert.match(styles, /\.combat-hud-list button \{[\s\S]*?border: 0;/u);
  assert.match(styles, /\.combat-hud-list button \{[\s\S]*?justify-content: flex-start;/u);
  assert.match(styles, /\.combat-hud-list button \{[\s\S]*?font-size: var\(--font-size-12, 12px\);/u);
  assert.match(styles, /span \{[\s\S]*?white-space: nowrap;/u);
});
