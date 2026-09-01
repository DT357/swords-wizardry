import assert from 'node:assert/strict';
import test from 'node:test';

import { findNegativeTangibleValues } from '../../../module/actor/data-diagnostics.mjs';

test('negative-value diagnostic reports source values without mutating Documents', () => {
  const item = {
    uuid: 'Actor.a1.Item.i1',
    name: 'Legacy Gear',
    type: 'item',
    _source: { system: { quantity: -2, weight: -1 } }
  };
  const actor = { uuid: 'Actor.a1', items: [item] };
  const before = structuredClone(item._source);
  assert.deepEqual(findNegativeTangibleValues([actor]), [{
    actorUuid: 'Actor.a1',
    itemUuid: 'Actor.a1.Item.i1',
    itemName: 'Legacy Gear',
    fields: { quantity: -2, weight: -1 }
  }]);
  assert.deepEqual(item._source, before);
});
