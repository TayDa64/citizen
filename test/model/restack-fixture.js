// Shared real-Postgres fixture for the campaign restack checks
// (test/model/campaign-restack-atomicity.api.js and the race and
// compensation tests in test/api). Not a test file itself.
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { createThrowawayDatabase } from '../api/throwaway-db.js';

export const WAGE = {
  id: 'evt-wage-live',
  type: 'policy_change',
  label: 'Wage ordinance',
  source: 'mock:test',
  timestamp: '2026-10-01T00:00:00.000Z',
  effect: { talentCost: 0.08 },
};

/** Burn with the wage event stacked (Slice 1 2200 × 1.08). */
export const FULL_BURN = 2376;
/** Burn with no world events (Slice 1 baseline at 25% tax). */
export const EMPTY_BURN = 2200;

/**
 * Store one live policy trigger nested under mv with a talent_cost effect,
 * the shape ingestAndPersist leaves behind for the nest filter to select.
 */
export async function insertLiveTrigger(pool, clientId, label, talentCostDelta) {
  await pool.query(
    `INSERT INTO real_world_triggers
       (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
     VALUES ($1, 'mock:test', 'policy_change', $2, now(), true, 'mv')`,
    [clientId, label],
  );
  const target = await pool.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const triggerRow = await pool.query(
    `SELECT id FROM real_world_triggers WHERE client_id = $1`,
    [clientId],
  );
  await pool.query(
    `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
     VALUES ($1, $2, $3::jsonb, 'output', true)`,
    [target.rows[0].id, triggerRow.rows[0].id, JSON.stringify({ op: 'mul', delta: talentCostDelta })],
  );
}

/** Migrated throwaway database with one live wage trigger nested under mv. */
export async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  for (const file of UP_MIGRATIONS) {
    await applyMigration(db.pool, file, 'up');
  }
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  await insertLiveTrigger(db.pool, WAGE.id, 'Wage ordinance', 0.08);
  return db;
}

/**
 * Wrap a pool so `onQuery(text, params)` runs before every statement issued
 * through any client it hands out, and may throw or wait.
 */
function poolWithQueryHook(pool, onQuery) {
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        query: async (text, params) => {
          await onQuery(typeof text === 'string' ? text : '', params);
          return client.query(text, params);
        },
        release: () => client.release(),
      };
    },
  };
}

/** A pool whose Nth `INSERT INTO turn_commits` throws, as a crash mid-restack would. */
export function poolThatDiesOnCommit(pool, failAt) {
  let inserts = 0;
  return poolWithQueryHook(pool, (text) => {
    if (!text.includes('INSERT INTO turn_commits')) return;
    inserts += 1;
    if (inserts === failAt) throw new Error('connection lost mid-restack');
  });
}

/**
 * A pool that parks a restack just after its clear_triggers row is written,
 * at the moment the next command asks for the campaign row lock, until
 * `release()`. `reached` resolves when it parks.
 *
 * Under the old one-commit-per-command loop the clear has committed and no
 * lock is held there, so a competitor runs inside the torn window. Under the
 * one-transaction restack the clear is uncommitted and the row is still
 * locked, so a competitor waits.
 */
export function poolThatPausesAfterClear(pool) {
  let release;
  let markReached;
  let clearWritten = false;
  let parked = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { markReached = resolve; });
  const wrapped = poolWithQueryHook(pool, async (text, params) => {
    if (text.includes('INSERT INTO turn_commits')
      && String(params?.[4] ?? '').includes('"clear_triggers"')) {
      clearWritten = true;
      return;
    }
    if (clearWritten && !parked && text.includes('FOR UPDATE')) {
      parked = true;
      markReached();
      await gate;
    }
  });
  return { pool: wrapped, reached, release };
}

/**
 * A pool that parks a restack at its first request for the campaign row lock,
 * before it has read the live triggers, until `release()`.
 */
export function poolThatPausesAtFirstLock(pool) {
  let release;
  let markReached;
  let parked = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const reached = new Promise((resolve) => { markReached = resolve; });
  const wrapped = poolWithQueryHook(pool, async (text) => {
    if (!parked && text.includes('FOR UPDATE')) {
      parked = true;
      markReached();
      await gate;
    }
  });
  return { pool: wrapped, reached, release };
}

/**
 * Wait until `promise` settles or some other session in this database is
 * waiting on a lock. Returns 'done' or 'blocked'. Lets one test drive both the
 * old per-commit loop (the competitor finishes inside the window) and the
 * locked restack (the competitor waits on the campaign row) without sleeps.
 */
export async function settledOrBlocked(pool, promise, { timeoutMs = 10_000 } = {}) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (settled) return 'done';
    const waiting = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0].n > 0) return 'blocked';
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('competitor neither finished nor blocked on a lock');
}

/** turn_commits command types for one campaign, in seq order. */
export async function ledgerTypes(pool, campaignId) {
  const result = await pool.query(
    `SELECT command_json->>'type' AS type FROM turn_commits
     WHERE campaign_id = $1 ORDER BY seq ASC`,
    [campaignId],
  );
  return result.rows.map((row) => row.type);
}
