// Regressions for the nest model findings (test/model/jurisdiction-nest-db.model.api.js).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { commitTurn, createCampaign, getCampaign } from '../../server/campaigns.js';
import { applicableTriggersForCampaign, buildServerRestackCommands } from '../../server/campaignRestack.js';
import { listCompanies, listTriggers, recomputeCompanies } from '../../server/triggers.js';
import { readApiSnapshot } from '../../src/simulationCore.js';
import { createGameState } from '../../src/turnEngine.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  for (const file of UP_MIGRATIONS) await applyMigration(db.pool, file, 'up');
  await db.pool.query(`INSERT INTO companies (name, cash, burn_rate, hype) VALUES ('Citizen', 15000, 2000, 0.3)`);
  return db;
}

async function insertTrigger(pool, clientId, jurisdictionId, delta) {
  const target = await pool.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const row = await pool.query(
    `INSERT INTO real_world_triggers (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
     VALUES ($1, 'mock:test', 'policy_change', $1, now(), true, $2) RETURNING id`,
    [clientId, jurisdictionId],
  );
  await pool.query(
    `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
     VALUES ($1, $2, $3::jsonb, 'output', true)`,
    [target.rows[0].id, row.rows[0].id, JSON.stringify({ op: 'mul', delta })],
  );
}

describe('nest restack regressions', { concurrency: 1, timeout: 120_000 }, () => {
  test('ClientRestackMatchesServer: GET /api/triggers leaves out peers and NULL, so a UI restack bills 2376 not 4277', async () => {
    const db = await migratedDatabase();
    try {
      await insertTrigger(db.pool, 'evt-mv-wage', 'mv', 0.08);
      await insertTrigger(db.pool, 'evt-sunnyvale-peer', 'sunnyvale', 0.5);
      await insertTrigger(db.pool, 'evt-null-jurisdiction', null, 0.2);
      const client = await db.pool.connect();
      try {
        await recomputeCompanies(client);
      } finally {
        client.release();
      }
      const listed = await listTriggers(db.pool);
      assert.deepEqual(listed.map((t) => t.id), ['evt-mv-wage']);

      const [company] = await listCompanies(db.pool);
      const reading = readApiSnapshot(createGameState(), { company, triggers: listed });
      const campaign = await createCampaign(db.pool, { seed: 'regression-client-restack' });
      for (const command of buildServerRestackCommands(reading.state.activeTriggers)) {
        await commitTurn(db.pool, campaign.id, command);
      }
      const advanced = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(advanced.state.company.burnRate, 2376);
      assert.equal(effectiveBurnRate((await getCampaign(db.pool, campaign.id)).state), 2376);
    } finally {
      await db.close();
    }
  });

  test('CampaignNestFromDb: a campaign homed on a jurisdiction row outside the seed still gets its chain', async () => {
    const db = await migratedDatabase();
    try {
      await db.pool.query(`INSERT INTO jurisdictions (id, name, tier, parent_id) VALUES ('pa', 'Palo Alto', 'city', 'sc_county')`);
      await insertTrigger(db.pool, 'evt-county-fee', 'sc_county', 0.02);
      await insertTrigger(db.pool, 'evt-pa-wage', 'pa', 0.08);
      await insertTrigger(db.pool, 'evt-mv-wage', 'mv', 0.5);
      const campaign = await createCampaign(db.pool, { seed: 'regression-pa' });
      await db.pool.query(`UPDATE campaigns SET home_jurisdiction_id = 'pa' WHERE id = $1`, [campaign.id]);
      const { homeId, triggers } = await applicableTriggersForCampaign(db.pool, campaign.id);
      assert.equal(homeId, 'pa');
      assert.deepEqual(triggers.map((t) => t.id), ['evt-county-fee', 'evt-pa-wage']);
    } finally {
      await db.close();
    }
  });
});
