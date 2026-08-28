import assert from 'node:assert/strict';
import test from 'node:test';

class TypeDataModel {
  static validateJoint() {}
}
class SimpleField {
  constructor(options = {}) {
    this.options = options;
  }
}
class SchemaField {
  constructor(fields, options = {}) {
    this.fields = fields;
    this.options = options;
  }
}
class ArrayField {
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
  }
}

globalThis.foundry = {
  abstract: { TypeDataModel },
  data: {
    fields: {
      ArrayField,
      SchemaField,
      HTMLField: SimpleField,
      BooleanField: SimpleField,
      NumberField: SimpleField,
      StringField: SimpleField
    }
  }
};

const { SpellData } = await import('../../../module/item/item-model.mjs?spell-schema-test');

test('spell schema adds bounded casting configuration and ordered actions', () => {
  const schema = SpellData.defineSchema();
  assert.ok(schema.casting instanceof SchemaField);
  assert.deepEqual(schema.casting.fields.levelSource.options.choices, [
    'automatic', 'fixed', 'prompt', 'characterLevel', 'npcHitDice'
  ]);
  assert.equal(schema.casting.fields.fixedLevel.options.min, 1);
  assert.equal(schema.casting.fields.fixedLevel.options.integer, true);
  assert.equal(schema.casting.fields.fixedLevel.options.nullable, true);

  assert.ok(schema.actions instanceof ArrayField);
  assert.equal(schema.actions.options.max, 32);
  assert.deepEqual(schema.actions.options.initial, []);
  assert.ok(schema.actions.element instanceof SchemaField);
  assert.deepEqual(schema.actions.element.fields.kind.options.choices, [
    'damage', 'healing', 'attack', 'roll', 'effect', 'manual'
  ]);
  assert.equal(schema.actions.element.fields.label.options.maxLength, 100);
  assert.equal(schema.actions.element.fields.formula.options.maxLength, 200);
});

test('spell schema uses the documented NumberField min option', () => {
  const schema = SpellData.defineSchema();
  assert.equal(schema.spellLevel.options.min, 1);
  assert.equal('minimum' in schema.spellLevel.options, false);
});

test('spell joint validation enforces conditional action contracts', () => {
  assert.throws(() => SpellData.validateJoint({
    casting: { levelSource: 'fixed', fixedLevel: null },
    actions: []
  }), /FIXED_LEVEL_REQUIRED/);
  assert.throws(() => SpellData.validateJoint({
    casting: { levelSource: 'prompt', fixedLevel: null },
    actions: [{ id: 'damage', kind: 'damage', label: 'Damage', formula: '' }]
  }), /FORMULA_REQUIRED/);
  assert.doesNotThrow(() => SpellData.validateJoint({
    casting: { levelSource: 'prompt', fixedLevel: null },
    actions: [{ id: 'manual', kind: 'manual', label: 'Adjudicate' }]
  }));
});
