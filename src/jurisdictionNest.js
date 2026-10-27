/**
 * CIT-80 / migration 006 — jurisdiction nest filter.
 *
 * Applicable set for a campaign home city = that city + ancestors only.
 * Peers (same tier, different id) do not apply. NULL jurisdiction_id on a
 * trigger matches no campaign (fail closed). Chain filter runs before
 * buildTriggerRestackCommands (CIT-69); this module does not restack.
 */

/** Checked-in seed matching migrations/006_jurisdiction_nest.sql. */
export const JURISDICTION_SEED = Object.freeze([
  Object.freeze({ id: 'us', name: 'United States', tier: 'federal', parentId: null }),
  Object.freeze({ id: 'ca', name: 'California', tier: 'state', parentId: 'us' }),
  Object.freeze({ id: 'sc_county', name: 'Santa Clara County', tier: 'county', parentId: 'ca' }),
  Object.freeze({ id: 'mv', name: 'Mountain View', tier: 'city', parentId: 'sc_county' }),
  Object.freeze({ id: 'sunnyvale', name: 'Sunnyvale', tier: 'city', parentId: 'sc_county' }),
]);

export const JURISDICTION_TIERS = Object.freeze(['federal', 'state', 'county', 'city']);

/** Wage bulletin client_id prefix — migration backfill + ingest stamp target. */
export const WAGE_BULLETIN_CLIENT_ID_PREFIX = 'evt-pipeline-obs-civic-wage-bulletin-';

/**
 * Recursive CTE matching wave2 schema sketch.
 * Bind $1 = campaign home jurisdiction id.
 */
export const JURISDICTION_CHAIN_CTE = `
WITH RECURSIVE chain AS (
  SELECT id, parent_id FROM jurisdictions WHERE id = $1
  UNION ALL
  SELECT j.id, j.parent_id
  FROM jurisdictions j
  JOIN chain c ON j.id = c.parent_id
)
`.trim();

/** Full SELECT of triggers whose jurisdiction_id is on the home ancestor chain. */
export const FILTER_TRIGGERS_FOR_HOME_SQL = `
${JURISDICTION_CHAIN_CTE}
SELECT t.*
FROM real_world_triggers t
WHERE t.jurisdiction_id IN (SELECT id FROM chain)
`.trim();

export function jurisdictionById(jurisdictions = JURISDICTION_SEED) {
  const map = new Map();
  for (const row of jurisdictions) {
    if (row?.id == null) continue;
    map.set(String(row.id), {
      id: String(row.id),
      name: row.name == null ? String(row.id) : String(row.name),
      tier: row.tier == null ? null : String(row.tier),
      parentId:
        row.parentId == null && row.parent_id == null
          ? null
          : String(row.parentId ?? row.parent_id),
    });
  }
  return map;
}

/**
 * Home city + ancestors (outer tiers), home first then parents.
 * Unknown home → empty chain (fail closed).
 */
export function ancestorChainIds(homeId, jurisdictions = JURISDICTION_SEED) {
  if (homeId == null || homeId === '') return [];
  const byId = jurisdictionById(jurisdictions);
  const home = String(homeId);
  if (!byId.has(home)) return [];
  const chain = [];
  const seen = new Set();
  let current = home;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    const row = byId.get(current);
    current = row?.parentId ?? null;
  }
  return chain;
}

/**
 * Filter triggers to those on the home ancestor chain.
 * NULL / missing jurisdictionId → omit (matches no campaign).
 */
export function filterTriggersForHome(triggers, homeId, jurisdictions = JURISDICTION_SEED) {
  const list = Array.isArray(triggers) ? triggers : [];
  const chain = new Set(ancestorChainIds(homeId, jurisdictions));
  if (chain.size === 0) return [];
  return list.filter((trigger) => {
    const jurisdictionId = trigger?.jurisdictionId ?? trigger?.jurisdiction_id ?? null;
    if (jurisdictionId == null || jurisdictionId === '') return false;
    return chain.has(String(jurisdictionId));
  });
}

/** Stamp known fixture client_ids onto a jurisdiction (server ingest / backfill). */
export function resolveJurisdictionForClientId(clientId) {
  if (typeof clientId !== 'string' || clientId === '') return null;
  if (clientId.startsWith(WAGE_BULLETIN_CLIENT_ID_PREFIX)) return 'mv';
  return null;
}

/**
 * Persist known fixture → jurisdiction maps without changing TRIGGER_CONTRACT.
 * Safe no-op when no matching rows. Requires migration 006 applied.
 */
export async function stampTriggerJurisdictions(pool, clientIds) {
  const list = Array.isArray(clientIds) ? clientIds : [];
  let stamped = 0;
  for (const clientId of list) {
    const jurisdictionId = resolveJurisdictionForClientId(clientId);
    if (jurisdictionId == null) continue;
    const result = await pool.query(
      `UPDATE real_world_triggers
       SET jurisdiction_id = $2
       WHERE client_id = $1
         AND (jurisdiction_id IS DISTINCT FROM $2)`,
      [clientId, jurisdictionId],
    );
    stamped += result.rowCount ?? 0;
  }
  return stamped;
}
