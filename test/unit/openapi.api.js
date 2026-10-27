import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { startServer } from '../../server/index.js';

test('OpenAPI document publishes TRIGGER_CONTRACT v1', () => {
  const spec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.info.version, '0.8.1');
  assert.ok(spec.paths['/api/campaigns']);
  assert.ok(spec.paths['/api/campaigns/{id}']);
  assert.ok(spec.paths['/api/campaigns/{id}/turns']);
  assert.deepEqual(
    spec.components.schemas.TurnCommand.properties.type.enum,
    ['set_tax', 'advance_turn', 'apply_trigger', 'remove_trigger', 'clear_triggers', 'hire_employee']
  );
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

  const errorMessage = spec.components.schemas.ErrorMessage;
  assert.equal(errorMessage.additionalProperties, false);
  assert.deepEqual(errorMessage.required, ['error']);
  assert.equal(errorMessage.properties.error.type, 'string');
  assert.equal(errorMessage.properties.issues.type, 'array');
  assert.equal(errorMessage.properties.issues.items.type, 'object');
  const invalid =
    spec.paths['/api/triggers'].post.responses['400'].content['application/json'].examples
      .invalidPayload.value;
  assert.equal(invalid.error, 'Invalid trigger payload');
  assert.equal(Array.isArray(invalid.issues), true);
});

function matchesSchema(body, schema, spec) {
  if (schema.$ref) {
    return matchesSchema(body, spec.components.schemas[schema.$ref.split('/').pop()], spec);
  }
  if (schema.type === 'object') {
    assert.equal(typeof body, 'object');
    assert.ok(body);
    assert.equal(Array.isArray(body), false);
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(body)) {
        assert.equal(Object.prototype.hasOwnProperty.call(properties, key), true, key);
      }
    }
    for (const key of schema.required || []) {
      assert.equal(Object.prototype.hasOwnProperty.call(body, key), true, key);
    }
    for (const [key, value] of Object.entries(body)) {
      if (properties[key]) matchesSchema(value, properties[key], spec);
    }
    return;
  }
  if (schema.type === 'array') {
    assert.equal(Array.isArray(body), true);
    for (const item of body) matchesSchema(item, schema.items, spec);
    return;
  }
  if (schema.type === 'string') {
    assert.equal(typeof body, 'string');
    return;
  }
  assert.fail(`unhandled schema type ${schema.type}`);
}

function requestJson({ port, method, path, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: body
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {}
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('real 400 and 405 bodies match ErrorMessage', async () => {
  const spec = JSON.parse(fs.readFileSync('openapi.json', 'utf8'));
  const schema = spec.components.schemas.ErrorMessage;
  const server = await startServer({ pool: null, port: 0, host: '127.0.0.1' });
  try {
    const port = server.address().port;
    const invalid = await requestJson({
      port,
      method: 'POST',
      path: '/api/triggers',
      body: '{}'
    });
    assert.equal(invalid.status, 400);
    matchesSchema(invalid.body, schema, spec);
    assert.equal(invalid.body.error, 'Invalid trigger payload');
    assert.ok(invalid.body.issues.length > 0);
    assert.equal(typeof invalid.body.issues[0].path, 'string');
    assert.equal(typeof invalid.body.issues[0].code, 'string');
    assert.equal(typeof invalid.body.issues[0].message, 'string');

    const method = await requestJson({ port, method: 'PUT', path: '/api/triggers' });
    assert.equal(method.status, 405);
    matchesSchema(method.body, schema, spec);
    assert.deepEqual(method.body, { error: 'Method not allowed', issues: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
