import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_INGEST_FIXTURE_ID,
  formatChangedLine,
  resolveFixtureId,
  resolveIngestOnceOptions,
} from '../../server/ingestOnce.js';
import { shouldRestackAfterIngest } from '../../server/campaignRestack.js';

test('resolveFixtureId defaults to civic-wage-bulletin', () => {
  assert.equal(resolveFixtureId([], {}), DEFAULT_INGEST_FIXTURE_ID);
  assert.equal(resolveFixtureId([], {}), 'civic-wage-bulletin');
});

test('resolveFixtureId prefers --fixture over INGEST_FIXTURE_ID', () => {
  assert.equal(
    resolveFixtureId(['--fixture', 'civic-wage-bulletin'], {
      INGEST_FIXTURE_ID: 'civic-wage-bulletin',
    }),
    'civic-wage-bulletin',
  );
  assert.equal(
    resolveFixtureId(['--fixture=civic-wage-bulletin'], {}),
    'civic-wage-bulletin',
  );
  assert.equal(
    resolveFixtureId([], { INGEST_FIXTURE_ID: 'civic-wage-bulletin' }),
    'civic-wage-bulletin',
  );
});

test('resolveFixtureId rejects unknown fixture and unknown flags', () => {
  assert.throws(
    () => resolveFixtureId(['--fixture', 'nope'], {}),
    (error) => error.code === 'unknown_fixture',
  );
  assert.throws(
    () => resolveFixtureId([], { INGEST_FIXTURE_ID: 'nope' }),
    (error) => error.code === 'unknown_fixture',
  );
  assert.throws(
    () => resolveFixtureId(['--fixture'], {}),
    (error) => error.code === 'invalid_fixture_flag',
  );
  assert.throws(
    () => resolveFixtureId(['--schedule'], {}),
    (error) => error.code === 'unknown_flag',
  );
});

test('resolveIngestOnceOptions campaignId default off; accepts --campaign UUID', () => {
  assert.deepEqual(resolveIngestOnceOptions([], {}), {
    fixtureId: DEFAULT_INGEST_FIXTURE_ID,
    campaignId: null,
  });
  const id = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(resolveIngestOnceOptions(['--campaign', id], {}), {
    fixtureId: DEFAULT_INGEST_FIXTURE_ID,
    campaignId: id,
  });
  assert.throws(
    () => resolveIngestOnceOptions(['--campaign', 'nope'], {}),
    (error) => error.code === 'invalid_campaign_flag',
  );
  assert.equal(shouldRestackAfterIngest({ campaignId: null, changed: true, triggerCount: 1 }), false);
  assert.equal(shouldRestackAfterIngest({ campaignId: id, changed: false, triggerCount: 1 }), false);
  assert.equal(shouldRestackAfterIngest({ campaignId: id, changed: true, triggerCount: 0 }), false);
  assert.equal(shouldRestackAfterIngest({ campaignId: id, changed: true, triggerCount: 1 }), true);
});

test('formatChangedLine matches CivicBrief botResult tokens', () => {
  assert.equal(formatChangedLine(true), 'changed=true');
  assert.equal(formatChangedLine(false), 'changed=false');
  assert.equal(formatChangedLine(1), 'changed=true');
  assert.equal(formatChangedLine(0), 'changed=false');
});

test('package.json exposes ingest:once script without schedule cron key', async () => {
  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['ingest:once'], 'node server/ingestOnce.js');
  assert.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, 'schedule'), false);

  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.equal(/^\s*schedule\s*:/m.test(ci), false);
  const workflows = fs.readdirSync('.github/workflows');
  for (const name of workflows) {
    const body = fs.readFileSync(`.github/workflows/${name}`, 'utf8');
    assert.equal(
      /^\s*schedule\s*:/m.test(body),
      false,
      `${name} must not add GitHub Actions schedule: yet (CIT-67 dispatch-docs only)`,
    );
  }
});
