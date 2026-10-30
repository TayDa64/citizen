import {
  COMPANIES_READ_MODEL_HOME,
  JURISDICTION_CHAIN_CTE,
  resolveCreateTriggerJurisdiction
} from '../src/jurisdictionNest.js';
import {
  HYPE_BOUNDS,
  TALENT_COST_BOUNDS,
  TRIGGER_TYPES,
  TriggerValidationError,
  roundTo,
  stackTriggerEffects,
  validateTriggerId,
  validateTriggerPayload,
  validateTriggerRecord
} from '../src/triggerContract.js';
import { burnFromBase, composeTalentMultiplier, resolveTalentCostFactor } from '../src/talentBurn.js';

const METRICS = {
  hype: { objectName: 'hype', bounds: HYPE_BOUNDS, op: 'add' },
  talentCost: { objectName: 'talent_cost', bounds: TALENT_COST_BOUNDS, op: 'mul' }
};

const TRIGGER_SELECT = `
  SELECT t.client_id,
         t.trigger_type,
         t.label,
         t.source_url,
         t.scraped_at,
         so.name AS target_name,
         e.formula
  FROM real_world_triggers t
  JOIN effects e ON e.trigger_id = t.id AND e.is_active
  JOIN simulation_objects so ON so.id = e.target_id
  WHERE t.client_id IS NOT NULL
    AND t.trigger_type = ANY($1::text[])
`;

function formulaDelta(formula) {
  const parsed = typeof formula === 'string' ? JSON.parse(formula) : formula;
  return Number(parsed.delta);
}

function triggerModels(rows) {
  const byId = new Map();
  for (const row of rows) {
    let model = byId.get(row.client_id);
    if (!model) {
      model = { id: row.client_id, effect: {} };
      byId.set(row.client_id, model);
    }
    if (row.target_name === 'hype') model.effect.hype = formulaDelta(row.formula);
    if (row.target_name === 'talent_cost') model.effect.talentCost = formulaDelta(row.formula);
  }
  return [...byId.values()];
}

export function rowsToTriggerRecords(rows) {
  const records = [];
  const byId = new Map();
  for (const row of rows) {
    let record = byId.get(row.client_id);
    if (!record) {
      record = {
        id: row.client_id,
        type: row.trigger_type,
        label: row.label,
        source: row.source_url,
        timestamp: row.scraped_at.toISOString(),
        effect: {}
      };
      byId.set(row.client_id, record);
      records.push(record);
    }
    if (row.target_name === 'hype') record.effect.hype = formulaDelta(row.formula);
    if (row.target_name === 'talent_cost') record.effect.talentCost = formulaDelta(row.formula);
  }
  return records
    .filter((record) => record.effect.hype != null || record.effect.talentCost != null)
    .map((record) => {
      const validated = validateTriggerRecord(record);
      if (!validated.ok) {
        throw new Error('Stored trigger did not match the API contract');
      }
      return validated.value;
    });
}

async function metricId(client, objectName, bounds) {
  const result = await client.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ($1, 'metric', $2, $3, $4)
     ON CONFLICT (name) DO UPDATE
       SET min_value = EXCLUDED.min_value,
           max_value = EXCLUDED.max_value,
           default_value = EXCLUDED.default_value
     RETURNING id`,
    [objectName, bounds.fallback, bounds.min, bounds.max]
  );
  return result.rows[0].id;
}

function finiteRounded(value, places) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return roundTo(numeric, places);
}

function firstFinite(places, ...values) {
  for (const value of values) {
    const rounded = finiteRounded(value, places);
    if (rounded != null) return rounded;
  }
  return null;
}

function baselineNumber(stored, current, fallback, places) {
  return firstFinite(places, stored, current, fallback);
}

async function triggerJurisdictionColumnReady(client) {
  const result = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'real_world_triggers'
       AND column_name = 'jurisdiction_id'
     LIMIT 1`
  );
  return result.rowCount > 0;
}

// Recompute runs on trigger create, replace, delete, and clear. A company
// inserted while triggers are already active keeps its own hype and talent
// cost until the next one of those writes. That write captures a null
// baseline from the row as it stands, so the new company does not inherit
// effects that were applied before it existed.
//
// CIT-95: when jurisdiction_id exists, stack only home + ancestors (default mv).
// Peers (sunnyvale) and NULL jurisdiction_id are fail-closed / omitted.
export async function recomputeCompanies(
  client,
  { homeId = COMPANIES_READ_MODEL_HOME } = {}
) {
  const companies = await client.query(
    `SELECT id, hype, talent_cost, hype_baseline, talent_cost_baseline
     FROM companies
     ORDER BY id
     FOR UPDATE`
  );
  const nestReady = await triggerJurisdictionColumnReady(client);
  const effectRows = nestReady
    ? await client.query(
        `${JURISDICTION_CHAIN_CTE}
SELECT t.client_id, so.name AS target_name, e.formula
FROM real_world_triggers t
JOIN effects e ON e.trigger_id = t.id AND e.is_active
JOIN simulation_objects so ON so.id = e.target_id
WHERE t.client_id IS NOT NULL
  AND t.trigger_type = ANY($2::text[])
  AND t.jurisdiction_id IN (SELECT id FROM chain)
ORDER BY t.client_id, so.name`,
        [homeId, TRIGGER_TYPES]
      )
    : await client.query(
        `SELECT t.client_id, so.name AS target_name, e.formula
         FROM real_world_triggers t
         JOIN effects e ON e.trigger_id = t.id AND e.is_active
         JOIN simulation_objects so ON so.id = e.target_id
         WHERE t.client_id IS NOT NULL
           AND t.trigger_type = ANY($1::text[])
         ORDER BY t.client_id, so.name`,
        [TRIGGER_TYPES]
      );
  const active = triggerModels(effectRows.rows);
  for (const company of companies.rows) {
    const baselines = {
      hype: baselineNumber(company.hype_baseline, company.hype, HYPE_BOUNDS.fallback, 4),
      talentCost: baselineNumber(
        company.talent_cost_baseline,
        company.talent_cost,
        TALENT_COST_BOUNDS.fallback,
        2
      )
    };
    const stacked = stackTriggerEffects(baselines, active);
    await client.query(
      `UPDATE companies
       SET hype = $2,
           talent_cost = $3,
           hype_baseline = $4,
           talent_cost_baseline = $5
       WHERE id = $1`,
      [company.id, stacked.hype, stacked.talentCost, baselines.hype, baselines.talentCost]
    );
  }
}

export async function createTrigger(pool, payload) {
  const validated = validateTriggerPayload(payload);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid trigger payload', validated.issues);
  }
  const trigger = validated.value;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nestReady = await triggerJurisdictionColumnReady(client);
    const jurisdictionId = nestReady
      ? resolveCreateTriggerJurisdiction(trigger.id)
      : null;
    const inserted = nestReady
      ? await client.query(
          `INSERT INTO real_world_triggers
             (client_id, source_url, extracted, trigger_type, label, scraped_at, processed, jurisdiction_id)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, true, $7)
           ON CONFLICT (client_id) DO UPDATE
             SET source_url = EXCLUDED.source_url,
                 extracted = EXCLUDED.extracted,
                 trigger_type = EXCLUDED.trigger_type,
                 label = EXCLUDED.label,
                 scraped_at = EXCLUDED.scraped_at,
                 processed = true,
                 jurisdiction_id = EXCLUDED.jurisdiction_id
           RETURNING id`,
          [
            trigger.id,
            trigger.source,
            JSON.stringify(trigger),
            trigger.type,
            trigger.label,
            trigger.timestamp,
            jurisdictionId
          ]
        )
      : await client.query(
          `INSERT INTO real_world_triggers
             (client_id, source_url, extracted, trigger_type, label, scraped_at, processed)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, true)
           ON CONFLICT (client_id) DO UPDATE
             SET source_url = EXCLUDED.source_url,
                 extracted = EXCLUDED.extracted,
                 trigger_type = EXCLUDED.trigger_type,
                 label = EXCLUDED.label,
                 scraped_at = EXCLUDED.scraped_at,
                 processed = true
           RETURNING id`,
          [
            trigger.id,
            trigger.source,
            JSON.stringify(trigger),
            trigger.type,
            trigger.label,
            trigger.timestamp
          ]
        );
    const triggerId = inserted.rows[0].id;
    await client.query('DELETE FROM effects WHERE trigger_id = $1', [triggerId]);
    const impactNames = [];
    for (const field of ['hype', 'talentCost']) {
      if (trigger.effect[field] == null) continue;
      const metric = METRICS[field];
      const targetId = await metricId(client, metric.objectName, metric.bounds);
      impactNames.push(metric.objectName);
      await client.query(
        `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
         VALUES ($1, $2, $3::jsonb, 'output', true)`,
        [
          targetId,
          triggerId,
          JSON.stringify({ op: metric.op, delta: trigger.effect[field] })
        ]
      );
    }
    await client.query(
      `UPDATE real_world_triggers
       SET impact_objects = ARRAY(
         SELECT id FROM simulation_objects WHERE name = ANY($2::text[])
       )
       WHERE id = $1`,
      [triggerId, impactNames]
    );
    await recomputeCompanies(client);
    await client.query('COMMIT');
    const stored = await client.query(
      `${TRIGGER_SELECT} AND t.client_id = $2 ORDER BY so.name ASC`,
      [TRIGGER_TYPES, trigger.id]
    );
    const [record] = rowsToTriggerRecords(stored.rows);
    if (!record) throw new Error('Trigger insert did not produce a readable effect');
    return record;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be aborted.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection may already be aborted.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTrigger(pool, id) {
  const validated = validateTriggerId(id);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid trigger id', validated.issues);
  }
  await withTransaction(pool, async (client) => {
    const removed = await client.query(
      `DELETE FROM real_world_triggers
       WHERE client_id = $1
         AND trigger_type = ANY($2::text[])
       RETURNING id`,
      [validated.value, TRIGGER_TYPES]
    );
    if (removed.rowCount === 0) {
      const missing = new Error('Trigger not found');
      missing.status = 404;
      missing.issues = [];
      throw missing;
    }
    await recomputeCompanies(client);
  });
}

export async function clearTriggers(pool) {
  await withTransaction(pool, async (client) => {
    await client.query(
      `DELETE FROM real_world_triggers
       WHERE trigger_type = ANY($1::text[])`,
      [TRIGGER_TYPES]
    );
    await recomputeCompanies(client);
  });
}

// GET /api/triggers is the world-event stack the UI shows and pushes onto a
// campaign (App.jsx buildTriggerRestackCommands). It lists the same set the
// companies read model stacks: home + ancestors (default mv) once
// jurisdiction_id exists. Peers (sunnyvale) and NULL jurisdiction_id are
// left out, so the campaign never bills an event /api/companies ignores.
// Before migration 006 there is no nest and every trigger is listed.
export async function listTriggers(pool, { homeId = COMPANIES_READ_MODEL_HOME } = {}) {
  const nestReady = await triggerJurisdictionColumnReady(pool);
  const result = nestReady
    ? await pool.query(
        `${JURISDICTION_CHAIN_CTE}
${TRIGGER_SELECT.replace('$1::text[]', '$2::text[]')}
  AND t.jurisdiction_id IN (SELECT id FROM chain)
ORDER BY t.scraped_at DESC, t.client_id DESC, so.name ASC`,
        [homeId, TRIGGER_TYPES]
      )
    : await pool.query(
        `${TRIGGER_SELECT} ORDER BY t.scraped_at DESC, t.client_id DESC, so.name ASC`,
        [TRIGGER_TYPES]
      );
  return rowsToTriggerRecords(result.rows);
}

/**
 * CIT-101 — load stored contract triggers by client_id for idempotent ingest
 * (source id + document timestamp → changed=false on identical re-run).
 */
export async function listTriggersByClientIds(pool, clientIds) {
  const ids = [...new Set((Array.isArray(clientIds) ? clientIds : []).filter(
    (id) => typeof id === 'string' && id.trim() !== '',
  ))];
  if (ids.length === 0) return [];
  const result = await pool.query(
    `${TRIGGER_SELECT} AND t.client_id = ANY($2::text[])
     ORDER BY t.scraped_at DESC, t.client_id DESC, so.name ASC`,
    [TRIGGER_TYPES, ids],
  );
  return rowsToTriggerRecords(result.rows);
}

/** True when an existing row matches the incoming contract id + document timestamp. */
export function isIdenticalTriggerDocument(existing, incoming) {
  if (!existing || !incoming) return false;
  if (existing.id !== incoming.id) return false;
  const left = existing.timestamp == null
    ? null
    : new Date(existing.timestamp).toISOString();
  const right = incoming.timestamp == null
    ? null
    : new Date(incoming.timestamp).toISOString();
  return left != null && right != null && left === right;
}

export async function listCompanies(pool) {
  const result = await pool.query(
    `SELECT id, name, cash, burn_rate, hype, talent_cost, hype_baseline, talent_cost_baseline
     FROM companies
     ORDER BY founded_at ASC, id ASC`
  );
  const ids = result.rows.map((row) => row.id);
  const employeesByCompany = new Map();
  if (ids.length > 0) {
    const employees = await pool.query(
      `SELECT company_id, department, skill_tech, skill_marketing, skill_sales, is_active
       FROM employees
       WHERE company_id = ANY($1::uuid[])`,
      [ids]
    );
    for (const employee of employees.rows) {
      const list = employeesByCompany.get(employee.company_id) ?? [];
      list.push(employee);
      employeesByCompany.set(employee.company_id, list);
    }
  }
  return result.rows.map((row) => {
    const profile = composeTalentMultiplier({
      employees: employeesByCompany.get(row.id) ?? []
    });
    const talentMultiplier = finiteRounded(profile.talentMultiplier, 4) ?? 1;
    const talentCost = firstFinite(
      2,
      row.talent_cost,
      row.talent_cost_baseline,
      TALENT_COST_BOUNDS.fallback
    );
    const baselines = {
      hype: baselineNumber(row.hype_baseline, row.hype, HYPE_BOUNDS.fallback, 4),
      talentCost: baselineNumber(
        row.talent_cost_baseline,
        row.talent_cost,
        TALENT_COST_BOUNDS.fallback,
        2
      )
    };
    const resolved = resolveTalentCostFactor(talentCost, baselines.talentCost);
    const burn = burnFromBase(
      finiteRounded(row.burn_rate, 2) ?? 0,
      talentMultiplier,
      resolved.talentCostFactor,
      resolved.talentCostFactorClamped
    );
    const talentMix = (profile.talentMix ?? []).map((group) => ({
      department: group.department == null || group.department === '' ? null : String(group.department),
      headcount: finiteRounded(group.headcount, 0) ?? 0,
      avgSkill: finiteRounded(group.avgSkill, 4) ?? 0,
      weight: finiteRounded(group.weight, 4) ?? 1,
      contribution: finiteRounded(group.contribution, 4) ?? 0
    }));
    return {
      id: row.id,
      name: row.name,
      cash: finiteRounded(row.cash, 2) ?? 0,
      baseBurnRate: burn.baseBurnRate,
      burnRate: burn.burnRate,
      talentMultiplier,
      talentCostFactor: burn.talentCostFactor,
      talentCostFactorClamped: burn.talentCostFactorClamped,
      effectiveMultiplier: burn.effectiveMultiplier,
      talentMix,
      hype: firstFinite(4, row.hype, row.hype_baseline, HYPE_BOUNDS.fallback),
      talentCost,
      baselines
    };
  });
}
