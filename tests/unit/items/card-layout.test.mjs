import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const itemSource = readFileSync(
  new URL('../../../module/item/item.mjs', import.meta.url),
  'utf8'
);
const templateSource = readFileSync(
  new URL('../../../module/templates/items/item-card.hbs', import.meta.url),
  'utf8'
);

test('Armor and Item rolls use the shared icon, title, and enriched-description card', () => {
  assert.match(itemSource, /const ITEM_CARD_TEMPLATE = `systems\/\$\{SYSTEM_ID\}\/module\/templates\/items\/item-card\.hbs`;/u);
  assert.match(itemSource, /TextEditor\.enrichHTML/u);
  assert.match(itemSource, /renderTemplate\(ITEM_CARD_TEMPLATE/u);
  assert.match(templateSource, /<article class="swords-wizardry item-card"/u);
  assert.match(templateSource, /<header class="item-card__header">[\s\S]*?<img[^>]*src="\{\{item\.img\}\}"[\s\S]*?<h3 class="chat-card__title">\{\{item\.name\}\}<\/h3>/u);
  assert.match(templateSource, /<div class="item-card__description">\{\{\{description\}\}\}<\/div>/u);
});
