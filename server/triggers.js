import {
  applyDelta,
  HYPE_BOUNDS,
  TALENT_COST_BOUNDS,
  TriggerValidationError,
  validateTriggerPayload,
  validateTriggerRecord
} from '../src/triggerContract.js';

const METRICS = {
  hype: { objectName: 'hype', bounds: HYPE_BOUNDS },
  talentCost: { objectName: 'talent_cost', bounds: TALENT_COST_BOUNDS }
};

const TRIGGER_SELECT = `
  SELECT t.id,
         t.trigger_type,
         t.label,
         t.source_url,
         t.scraped_at,
         so.name AS target_name,
         e.formula
  FROM real_world_triggers t
  JOIN effects e ON e.trigger_id = t.id AND e.is_active
  JOIN simulation_objects so ON so.id = e.target_id
  WHERE t.trigger_type IS NOT NULL
`;

function formulaDelta(formula) {
  const parsed = typeof formula === 'string' ? JSON.parse(formula) : formula;
  return Number(parsed.delta);
}

export function rowsToTriggerRecords(rows) {
  const records = [];
  const byId = new Map();
  for (const row of rows) {
    let record = byId.get(row.id);
    if (!record) {
      record = {
        id: row.id,
        type: row.trigger_type,
        label: row.label,
        source: row.source_url,
        timestamp: row.scraped_at.toISOString(),
        effect: {}
      };
      byId.set(row.id, record);
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
     ON CONFLICT (name) DO UPDATE SET name = simulation_objects.name
     RETURNING id`,
    [objectName, bounds.fallback, bounds.min, bounds.max]
  );
  return result.rows[0].id;
}

export async function createTrigger(pool, payload) {
  const validated = validateTriggerPayload(payload);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid trigger payload', validated.issues);
  }
  const { type, label, source, effect } = validated.value;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO real_world_triggers
         (source_url, extracted, trigger_type, label, processed)
       VALUES ($1, $2::jsonb, $3, $4, true)
       RETURNING id`,
      [source, JSON.stringify({ type, label, source, effect }), type, label]
    );
    const triggerId = inserted.rows[0].id;
    const impactNames = [];
    for (const field of ['hype', 'talentCost']) {
      if (effect[field] == null) continue;
      const metric = METRICS[field];
      const targetId = await metricId(client, metric.objectName, metric.bounds);
      impactNames.push(metric.objectName);
      await client.query(
        `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
         VALUES ($1, $2, $3::jsonb, 'output', true)`,
        [targetId, triggerId, JSON.stringify({ op: 'add', delta: effect[field] })]
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

    const companies = await client.query('SELECT id, hype, talent_cost FROM companies FOR UPDATE');
    for (const company of companies.rows) {
      const values = [];
      const assignments = [];
      if (effect.hype != null) {
        values.push(applyDelta(company.hype, effect.hype, HYPE_BOUNDS));
        assignments.push(`hype = $${values.length}`);
      }
      if (effect.talentCost != null) {
        values.push(applyDelta(company.talent_cost, effect.talentCost, TALENT_COST_BOUNDS));
        assignments.push(`talent_cost = $${values.length}`);
      }
      values.push(company.id);
      await client.query(
        `UPDATE companies SET ${assignments.join(', ')} WHERE id = $${values.length}`,
        values
      );
    }

    await client.query('COMMIT');
    const stored = await client.query(`${TRIGGER_SELECT} AND t.id = $1 ORDER BY so.name ASC`, [
      triggerId
    ]);
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
    `${TRIGGER_SELECT} ORDER BY t.scraped_at DESC, t.id DESC, so.name ASC`
  );
  return rowsToTriggerRecords(result.rows);
}

export async function listCompanies(pool) {
  const result = await pool.query(
    `SELECT id, name, cash, burn_rate, hype, talent_cost
     FROM companies
     ORDER BY founded_at ASC, id ASC`
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    cash: Number(row.cash),
    burnRate: Number(row.burn_rate),
    hype: row.hype == null ? null : Number(row.hype),
    talentCost: row.talent_cost == null ? null : Number(row.talent_cost)
  }));
}
