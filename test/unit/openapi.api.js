import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('OpenAPI document publishes TRIGGER_CONTRACT v1', () => {
  const spec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.info.version, '0.7.0');
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of methods) {
      if (!item[method]) continue;
      assert.equal(
        item[method].responses['403'].$ref,
        '#/components/responses/ForbiddenHost',
        `${method} ${path}`
      );
      const hostResponse = item[method].responses['400'];
      assert.ok(hostResponse, `${method} ${path} documents 400`);
      const resolved = hostResponse.$ref
        ? spec.components.responses[hostResponse.$ref.split('/').pop()]
        : hostResponse;
      const examples = resolved.content['application/json'].examples;
      assert.deepEqual(examples.hostRequired.value, { error: 'Host required' }, `${method} ${path}`);
      assert.deepEqual(examples.duplicateHost.value, { error: 'Duplicate host' }, `${method} ${path}`);
    }
  }
  assert.equal(
    spec.components.responses.ForbiddenHost.content['application/json'].example.error,
    'Forbidden host'
  );
  const company = spec.components.schemas.Company;
  assert.equal(company.properties.talentMultiplier.multipleOf, 0.0001);
  assert.equal(company.properties.talentCostFactor.multipleOf, 0.0001);
  assert.equal(company.properties.talentCostFactor.minimum, 0.1);
  assert.equal(company.properties.talentCostFactor.maximum, 3);
  assert.equal(company.properties.talentCostFactorClamped.type, 'boolean');
  assert.equal(company.properties.effectiveMultiplier.multipleOf, 0.0001);
  assert.match(company.properties.burnRate.description, /no tax/);
  assert.match(company.properties.burnRate.description, /rounded once/);
  assert.equal(company.properties.effectiveMultiplier.minimum, 0);
  assert.equal(company.properties.baseBurnRate.type, 'number');
  assert.equal(company.properties.baselines.properties.talentMultiplier, undefined);
  assert.ok(company.required.includes('talentMultiplier'));
  assert.ok(company.required.includes('talentCostFactor'));
  assert.ok(company.required.includes('talentCostFactorClamped'));
  assert.ok(company.required.includes('effectiveMultiplier'));
  assert.ok(company.required.includes('talentMix'));
  assert.ok(company.required.includes('baseBurnRate'));
  assert.match(company.properties.talentMultiplier.description, /0\.5/);
  assert.match(company.properties.talentMix.description, /empty/);
  assert.match(spec.info.description, /NaN/);
  assert.equal(spec.paths['/api/triggers'].delete.responses['204'].description.length > 0, true);
  assert.equal(spec.paths['/api/triggers/{id}'].delete.responses['204'].description.length > 0, true);
  assert.equal(spec.paths['/api/triggers/{id}'].delete.responses['404'].description.length > 0, true);

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
