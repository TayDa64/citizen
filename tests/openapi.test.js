import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('OpenAPI document publishes the slice 2 trigger contract', () => {
  const spec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.info.version, '0.2.0');

  const example = spec.paths['/api/triggers'].post.responses['201'].content['application/json'].example;
  assert.deepEqual(Object.keys(example).sort(), [
    'effect',
    'id',
    'label',
    'source',
    'timestamp',
    'type'
  ]);
  assert.equal(typeof example.effect.hype, 'number');
  assert.equal(Object.hasOwn(example.effect, 'talentCost'), false);

  const talentExample =
    spec.paths['/api/triggers/mock'].post.responses['201'].content['application/json'].examples.talent.value;
  assert.deepEqual(talentExample.effect, { talentCost: 500 });
  assert.equal(talentExample.type, 'talent');
});
