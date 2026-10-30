// Model checks: the nest filter against real Postgres.
//
// Needs a local Postgres on /var/run/postgresql (same as test/api). Each
// test builds a throwaway database, applies every migration, and drops it.
//
// Promises:
//   NestSqlMatchesJs        — the SQL CTE (companies read model) and the JS
//                             chain (campaign restack) bind the same rows for
//                             random jurisdiction forests.
//   CampaignNestFromDb      — a campaign restack reads the jurisdictions
//                             table, not the in-code seed copy.
//   ClientRestackMatchesServer — the stack the UI pushes onto a campaign from
//                             GET /api/triggers equals the stack the server
//                             restack picks, and both equal the companies
//                             read model.
//
// Run: npm run check:model
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { commitTurn, createCampaign, getCampaign } from '../../server/campaigns.js';
import {
  applicableTriggersForCampaign,
  buildServerRestackCommands,
  listTriggersForRestack,
  restackCampaignTriggers,
} from '../../server/campaignRestack.js';
import { listCompanies, listTriggers, recomputeCompanies } from '../../server/triggers.js';
import {
  FILTER_TRIGGERS_FOR_HOME_SQL,
  JURISDICTION_CHAIN_CTE,
  ancestorChainIds,
  filterTriggersForHome,
} from '../../src/jurisdictionNest.js';
import { readApiSnapshot } from '../../src/simulationCore.js';
import { createGameState } from '../../src/turnEngine.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { createThrowawayDatabase } from '../api/throwaway-db.js';
import { genForest, rng } from './gen.js';

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  for (const file of UP_MIGRATIONS) await applyMigration(db.pool, file, 'up');
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype) VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  return db;
}

async function talentTargetId(pool) {
  const result = await pool.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  return result.rows[0].id;
}

async function insertTrigger(pool, clientId, jurisdictionId, talentDelta) {
  const row = await pool.query(
    `INSERT INTO real_world_triggers
       (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
     VALUES ($1, 'mock:model', 'policy_change', $1, '2026-01-01T00:00:00Z', true, $2)
     RETURNING id`,
    [clientId, jurisdictionId],
  );
  await pool.query(
    `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
     VALUES ($1, $2, $3::jsonb, 'output', true)`,
    [await talentTargetId(pool), row.rows[0].id, JSON.stringify({ op: 'mul', delta: talentDelta })],
  );
}

async function allJurisdictions(pool) {
  const result = await pool.query(`SELECT id, name, tier, parent_id FROM jurisdictions`);
  return result.rows;
}

describe('jurisdiction nest model (Postgres)', { concurrency: 1, timeout: 180_000 }, () => {
  test('NestSqlMatchesJs: SQL chain and JS chain bind the same jurisdictions and triggers', async () => {
    const db = await migratedDatabase();
    try {
      const r = rng(4242);
      for (let run = 0; run < 25; run += 1) {
        const forest = genForest(r, run % 6).map((row) => ({
          ...row,
          id: `r${run}_${row.id}`,
          parentId: row.parentId == null ? null : `r${run}_${row.parentId}`,
        }));
        for (const row of forest) {
          await db.pool.query(
            `INSERT INTO jurisdictions (id, name, tier, parent_id) VALUES ($1, $2, $3, $4)`,
            [row.id, row.name, row.tier, row.parentId],
          );
        }
        for (const [i, row] of forest.entries()) {
          if (r.bool(0.6)) await insertTrigger(db.pool, `evt-r${run}-${i}`, row.id, 0.01);
        }
        const rows = await allJurisdictions(db.pool);
        const listed = await listTriggersForRestack(db.pool);
        for (const home of forest.map((row) => row.id)) {
          const sql = await db.pool.query(`${JURISDICTION_CHAIN_CTE} SELECT id FROM chain`, [home]);
          assert.deepEqual(
            sql.rows.map((row) => row.id).sort(),
            ancestorChainIds(home, rows).sort(),
            `chain for ${home} (run ${run})`,
          );
          const sqlTriggers = await db.pool.query(FILTER_TRIGGERS_FOR_HOME_SQL, [home]);
          assert.deepEqual(
            sqlTriggers.rows.map((row) => row.client_id).sort(),
            filterTriggersForHome(listed, home, rows).map((t) => t.id).sort(),
            `triggers for ${home} (run ${run})`,
          );
        }
      }
    } finally {
      await db.close();
    }
  });

  test('CampaignNestFromDb: a home added to the jurisdictions table restacks its own chain', async () => {
    const db = await migratedDatabase();
    try {
      // Palo Alto is a real row (FK target) but not in JURISDICTION_SEED.
      await db.pool.query(
        `INSERT INTO jurisdictions (id, name, tier, parent_id) VALUES ('pa', 'Palo Alto', 'city', 'sc_county')`,
      );
      await insertTrigger(db.pool, 'evt-county-fee', 'sc_county', 0.02);
      await insertTrigger(db.pool, 'evt-pa-wage', 'pa', 0.08);
      await insertTrigger(db.pool, 'evt-mv-wage', 'mv', 0.5);
      const campaign = await createCampaign(db.pool, { seed: 'model-pa' });
      await db.pool.query(`UPDATE campaigns SET home_jurisdiction_id = 'pa' WHERE id = $1`, [campaign.id]);

      const { triggers } = await applicableTriggersForCampaign(db.pool, campaign.id);
      assert.deepEqual(triggers.map((t) => t.id), ['evt-county-fee', 'evt-pa-wage']);

      // Same home through the SQL read model (recomputeCompanies) agrees.
      const client = await db.pool.connect();
      try {
        await recomputeCompanies(client, { homeId: 'pa' });
      } finally {
        client.release();
      }
      const [company] = await listCompanies(db.pool);
      await restackCampaignTriggers(db.pool, campaign.id);
      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.company.talentCost, company.talentCost);
    } finally {
      await db.close();
    }
  });

  test('ClientRestackMatchesServer: UI restack from GET /api/triggers equals the server restack', async () => {
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

      // Client path (App.jsx): fetch /api/triggers + /api/companies, hydrate,
      // then buildTriggerRestackCommands(reading.state.activeTriggers).
      // buildServerRestackCommands is the server-side mirror of that builder.
      const [company] = await listCompanies(db.pool);
      const reading = readApiSnapshot(createGameState(), { company, triggers: await listTriggers(db.pool) });
      const viaClient = await createCampaign(db.pool, { seed: 'model-client' });
      for (const command of buildServerRestackCommands(reading.state.activeTriggers)) {
        await commitTurn(db.pool, viaClient.id, command);
      }

      const viaServer = await createCampaign(db.pool, { seed: 'model-server' });
      await restackCampaignTriggers(db.pool, viaServer.id);

      const clientState = (await getCampaign(db.pool, viaClient.id)).state;
      const serverState = (await getCampaign(db.pool, viaServer.id)).state;
      assert.deepEqual(
        clientState.activeTriggers.map((t) => t.id).sort(),
        serverState.activeTriggers.map((t) => t.id).sort(),
      );
      assert.equal(clientState.company.talentCost, company.talentCost);
      assert.equal(serverState.company.talentCost, company.talentCost);
      assert.equal(effectiveBurnRate(clientState), 2376);
      assert.equal(effectiveBurnRate(reading.state), 2376);
    } finally {
      await db.close();
    }
  });
});
