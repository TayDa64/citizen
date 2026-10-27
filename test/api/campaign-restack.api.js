import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { createCampaign, getCampaign, listTurnCommits } from '../../server/campaigns.js';
import { ingestAndPersist, listIngestRuns } from '../../server/eventIngest.js';
import { listCompanies } from '../../server/triggers.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migrateAll(pool) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
  }
}

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await migrateAll(db.pool);
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  return db;
}

describe('CIT-69 campaign restack after ingest', { concurrency: 1, timeout: 120_000 }, () => {
  test('default off: ingest without campaignId leaves state_json empty of pipeline triggers', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit69-off' });
      assert.equal(campaign.state.activeTriggers.length, 0);

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(ingested.triggers.length, 1);
      assert.equal(ingested.restack, undefined);

      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.activeTriggers.length, 0);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      assert.equal(companies[0].burnRate, 2160);
    } finally {
      await db.close();
    }
  });

  test('campaignId + changed wage: nest restack → campaign shows trigger; burn 2376 path', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit69-on' });
      assert.equal(campaign.state.taxRate, 0.25);

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
        campaignId: campaign.id,
      });
      assert.equal(ingested.triggers.length, 1);
      assert.equal(ingested.restack?.campaignId, campaign.id);
      assert.equal(ingested.restack?.homeId, 'mv');
      assert.deepEqual(ingested.restack?.appliedTriggerIds, [ingested.triggers[0].id]);

      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.activeTriggers.length, 1);
      assert.equal(reloaded.state.activeTriggers[0].id, ingested.triggers[0].id);
      assert.equal(reloaded.state.activeTriggers[0].effect.talentCost, 0.08);
      assert.equal(reloaded.state.company.talentCost, 4320);
      // Offline preview burn (apply_trigger updates talentCost; burn drains on advance).
      assert.equal(effectiveBurnRate(reloaded.state), 2376);

      const commits = await listTurnCommits(db.pool, campaign.id, { limit: 10 });
      assert.ok(commits.length >= 2);
      assert.equal(commits.some((row) => row.command?.type === 'clear_triggers'), true);
      assert.equal(commits.some((row) => row.command?.type === 'apply_trigger'), true);
      assert.equal(commits.some((row) => row.command?.type === 'RESTACK_INGEST'), false);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      // Companies cash is not the campaign write path.
      assert.equal(Number(companies[0].cash), 15000);

      const runs = await listIngestRuns(db.pool, { limit: 1 });
      assert.equal(runs[0].status, 'success');
      assert.equal(runs[0].changed, true);
      assert.equal(runs[0].result?.restack?.campaignId, campaign.id);
    } finally {
      await db.close();
    }
  });

  test('sunnyvale peer does not move mv campaign burn (stays wage 2376)', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit69-peer' });
      await db.pool.query(
        `INSERT INTO real_world_triggers
           (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
         VALUES
           ('evt-sunnyvale-peer-restack',
            'mock:sunnyvale',
            'policy_change',
            'Sunnyvale peer',
            now(),
            true,
            'sunnyvale')`,
      );
      // Peer needs an effect row to appear in restack listing; stamp via create path is heavier —
      // ingest wage and restack; peer without effects is invisible to listTriggers anyway.
      // Insert matching effects so peer is listed then filtered out.
      const peer = await db.pool.query(
        `SELECT id FROM real_world_triggers WHERE client_id = 'evt-sunnyvale-peer-restack'`,
      );
      const talent = await db.pool.query(
        `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
         VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      );
      await db.pool.query(
        `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
         VALUES ($1, $2, $3::jsonb, 'output', true)`,
        [talent.rows[0].id, peer.rows[0].id, JSON.stringify({ op: 'mul', delta: 0.5 })],
      );

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
        campaignId: campaign.id,
      });
      assert.equal(ingested.restack?.appliedTriggerIds.includes('evt-sunnyvale-peer-restack'), false);
      assert.deepEqual(ingested.restack?.appliedTriggerIds, [ingested.triggers[0].id]);

      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.activeTriggers.length, 1);
      assert.equal(reloaded.state.company.talentCost, 4320);
      assert.equal(effectiveBurnRate(reloaded.state), 2376);
      assert.equal(
        reloaded.state.activeTriggers.some((row) => row.id === 'evt-sunnyvale-peer-restack'),
        false,
      );
    } finally {
      await db.close();
    }
  });

  test('changed=false / zero triggers: campaignId set but no commitTurn', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit69-empty' });
      const beforeCommits = await listTurnCommits(db.pool, campaign.id, { limit: 50 });

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'http_stub',
        observations: [],
        campaignId: campaign.id,
      });
      assert.equal(ingested.triggers.length, 0);
      assert.equal(ingested.restack, undefined);

      const after = await getCampaign(db.pool, campaign.id);
      assert.equal(after.state.activeTriggers.length, 0);
      const afterCommits = await listTurnCommits(db.pool, campaign.id, { limit: 50 });
      assert.equal(afterCommits.length, beforeCommits.length);

      const runs = await listIngestRuns(db.pool, { limit: 1 });
      assert.equal(runs[0].status, 'success');
      assert.equal(runs[0].changed, false);
    } finally {
      await db.close();
    }
  });

  test('failed restack keeps triggers and marks ingest_runs error (not success)', async () => {
    const db = await migratedDatabase();
    try {
      const missing = '44444444-4444-4444-8444-444444444444';
      await assert.rejects(
        () =>
          ingestAndPersist(db.pool, {
            adapter: 'fixture',
            fixtureId: 'civic-wage-bulletin',
            campaignId: missing,
          }),
        (error) => error?.code === 'campaign_not_found' || /not found/i.test(error?.message || ''),
      );

      const triggers = await db.pool.query(
        `SELECT client_id, jurisdiction_id FROM real_world_triggers
         WHERE client_id LIKE 'evt-pipeline-obs-civic-wage-bulletin-%'`,
      );
      assert.equal(triggers.rowCount, 1);
      assert.equal(triggers.rows[0].jurisdiction_id, 'mv');

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      assert.equal(runs[0].status, 'error');
      assert.equal(runs[0].changed, false);
      assert.equal(runs[0].result?.restackFailed, true);
      assert.ok(Array.isArray(runs[0].triggerClientIds));
      assert.equal(runs[0].triggerClientIds.length, 1);
    } finally {
      await db.close();
    }
  });

  test('firecrawl still rejected; no triggers; no restack', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit69-fire' });
      await assert.rejects(
        () =>
          ingestAndPersist(db.pool, {
            adapter: 'firecrawl',
            campaignId: campaign.id,
          }),
        (error) => error instanceof TriggerValidationError,
      );
      const count = await db.pool.query(
        'SELECT COUNT(*)::int AS n FROM real_world_triggers WHERE client_id IS NOT NULL',
      );
      assert.equal(count.rows[0].n, 0);
      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.activeTriggers.length, 0);
    } finally {
      await db.close();
    }
  });
});
