import {
  HYPE_BOUNDS,
  TALENT_COST_BOUNDS,
  TRIGGER_TYPES,
  TriggerValidationError,
  roundTo,
  stackTriggerEffects,
  validateTriggerPayload,
  validateTriggerRecord
} from '../src/triggerContract.js';

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

function baselineNumber(stored, current, fallback, places) {
  const value = stored != null ? Number(stored) : current != null ? Number(current) : fallback;
  return roundTo(value, places);
}

async function recomputeCompanies(client) {
  const companies = await client.query(
    `SELECT id, hype, talent_cost, hype_baseline, talent_cost_baseline
     FROM companies
     ORDER BY id
     FOR UPDATE`
  );
  const effectRows = await client.query(
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
    const inserted = await client.query(
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

export async function listTriggers(pool) {
  const result = await pool.query(
    `${TRIGGER_SELECT} ORDER BY t.scraped_at DESC, t.client_id DESC, so.name ASC`,
    [TRIGGER_TYPES]
  );
  return rowsToTriggerRecords(result.rows);
}

export async function listCompanies(pool) {
  const result = await pool.query(
    `SELECT id, name, cash, burn_rate, hype, talent_cost, hype_baseline, talent_cost_baseline
     FROM companies
     ORDER BY founded_at ASC, id ASC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    cash: Number(row.cash),
    burnRate: Number(row.burn_rate),
    hype: row.hype == null ? null : roundTo(Number(row.hype), 4),
    talentCost: row.talent_cost == null ? null : roundTo(Number(row.talent_cost), 2),
    baselines: {
      hype: baselineNumber(row.hype_baseline, row.hype, HYPE_BOUNDS.fallback, 4),
      talentCost: baselineNumber(
        row.talent_cost_baseline,
        row.talent_cost,
        TALENT_COST_BOUNDS.fallback,
        2
      )
    }
  }));
}
