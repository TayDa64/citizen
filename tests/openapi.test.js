import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('OpenAPI document publishes TRIGGER_CONTRACT v1', () => {
  const spec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.info.version, '0.3.0');

  const trigger = spec.components.schemas.Trigger;
  assert.deepEqual(trigger.properties.type.enum, [
    'news_spike',
    'policy_change',
    'market_shift'
  ]);
  assert.equal(trigger.properties.id.format, undefined);
  assert.equal(spec.components.schemas.Effect.properties.talentCost.minimum, -100);
  assert.equal(spec.components.schemas.Effect.properties.talentCost.maximum, 100);
  assert.equal(spec.components.schemas.Effect.properties.hype.minimum, -1);
  assert.equal(spec.components.schemas.Effect.properties.hype.maximum, 1);

  const example = spec.paths['/api/triggers'].post.responses['201'].content['application/json'].example;
  assert.deepEqual(Object.keys(example).sort(), [
    'effect',
    'id',
    'label',
    'source',
    'timestamp',
    'type'
  ]);
  assert.equal(example.id, 'evt-news-sector-spike');
  assert.equal(example.type, 'news_spike');
  assert.deepEqual(example.effect, { hype: 0.1 });

  const examples =
    spec.paths['/api/triggers/mock'].post.responses['201'].content['application/json'].examples;
  assert.deepEqual(examples.policy_change.value.effect, { talentCost: 0.12 });
  assert.equal(examples.policy_change.value.type, 'policy_change');
  assert.deepEqual(examples.market_shift.value.effect, { talentCost: -0.08, hype: -0.05 });
  assert.deepEqual(spec.paths['/api/triggers/mock'].post.requestBody.content['application/json'].schema.properties.scenario.enum, [
    'news_spike',
    'policy_change',
    'market_shift'
  ]);
});
