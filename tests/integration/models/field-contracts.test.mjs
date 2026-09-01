import assert from 'node:assert/strict';
import test from 'node:test';

class TypeDataModel { static validateJoint() {} }
class SimpleField { constructor(options = {}) { this.options = options; } }
class SchemaField {
  constructor(fields, options = {}) { this.fields = fields; this.options = options; }
}
class ArrayField {
  constructor(element, options = {}) { this.element = element; this.options = options; }
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

const { ArmorData, FeatureData, ItemData } = await import('../../../module/item/item-model.mjs?field-contracts');
const { CharacterData } = await import('../../../module/actor/actor-model.mjs?field-contracts');

test('tangible fields use documented zero-safe NumberField constraints', () => {
  const schema = ItemData.defineSchema();
  for (const field of [schema.quantity, schema.weight]) {
    assert.equal(field.options.required, true);
    assert.equal(field.options.integer, true);
    assert.equal(field.options.nullable, false);
    assert.equal(field.options.min, 0);
    assert.equal(field.options.initial, 1);
    assert.equal('minimum' in field.options, false);
  }
});

test('character level uses the intended initial value option', () => {
  const schema = CharacterData.defineSchema();
  assert.equal(schema.level.fields.value.options.initial, '1');
  assert.equal('intitial' in schema.level.fields.value.options, false);
});

test('description-only features preserve a deliberately blank roll formula', () => {
  const schema = ItemData.defineSchema();
  assert.equal(schema.formula.options.initial, 'd6');
  const featureSchema = FeatureData.defineSchema();
  assert.equal(featureSchema.formula.options.initial, '');
});

test('existing Armor items default to equipped', () => {
  const schema = ArmorData.defineSchema();
  assert.equal(schema.equipped.options.initial, true);
});
