/**
 * CIT-116 — read-only jurisdiction nest for OpenAPI GET /api/jurisdictions.
 * Binds migration 006 rows; peers do not bind home.
 */

import {
  COMPANIES_READ_MODEL_HOME,
  buildJurisdictionNestView,
} from '../src/jurisdictionNest.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    parentId: row.parent_id ?? null,
  };
}

export async function listJurisdictionRows(pool) {
  const result = await pool.query(
    `SELECT id, name, tier, parent_id
     FROM jurisdictions
     ORDER BY
       CASE tier
         WHEN 'federal' THEN 0
         WHEN 'state' THEN 1
         WHEN 'county' THEN 2
         WHEN 'city' THEN 3
         ELSE 4
       END,
       id ASC`,
  );
  return result.rows.map(mapRow);
}

/**
 * Nest explorer payload for a campaign/companies home id (default mv).
 * Unknown home → empty chain/peers (fail closed).
 */
export async function getJurisdictionNest(pool, homeId = COMPANIES_READ_MODEL_HOME) {
  const rows = await listJurisdictionRows(pool);
  return buildJurisdictionNestView(homeId, rows);
}

export { COMPANIES_READ_MODEL_HOME };
