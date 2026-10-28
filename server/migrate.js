import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { assertLocalDatabase } from './database.js';

const upMarker = /^-- migrate:up\s*$/m;
const downMarker = /^-- migrate:down\s*$/m;

export function splitMigration(sql) {
  const hasUp = upMarker.test(sql);
  const hasDown = downMarker.test(sql);
  if (!hasUp && !hasDown) return { up: sql, down: '' };
  if (!hasUp || !hasDown) {
    throw new Error('Migration must contain both -- migrate:up and -- migrate:down');
  }
  const upStart = sql.search(upMarker);
  const downStart = sql.search(downMarker);
  if (downStart < upStart) {
    throw new Error('-- migrate:down must follow -- migrate:up');
  }
  const upLineEnd = sql.indexOf('\n', upStart);
  const downLineEnd = sql.indexOf('\n', downStart);
  return {
    up: sql.slice(upLineEnd + 1, downStart),
    down: sql.slice(downLineEnd + 1)
  };
}

export async function applyMigration(client, filePath, direction) {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unknown migration direction: ${direction}`);
  }
  const sql = fs.readFileSync(filePath, 'utf8');
  const parts = splitMigration(sql);
  const statement = parts[direction];
  if (!statement || !statement.trim()) {
    throw new Error(`Migration ${filePath} has no ${direction} section`);
  }
  await client.query(statement);
}

export const UP_MIGRATIONS = Object.freeze([
  'migrations/001_initial_schema.sql',
  'migrations/002_real_world_trigger_effects.sql',
  'migrations/003_trigger_contract_v1.sql',
  'migrations/004_campaign_turns.sql',
  'migrations/005_ingest_runs.sql',
  'migrations/006_jurisdiction_nest.sql',
  'migrations/007_scheduled_meetings.sql',
]);

export const DOWN_MIGRATIONS = Object.freeze([
  'migrations/007_scheduled_meetings.sql',
  'migrations/006_jurisdiction_nest.sql',
  'migrations/005_ingest_runs.sql',
  'migrations/004_campaign_turns.sql',
  'migrations/003_trigger_contract_v1.sql',
  'migrations/002_real_world_trigger_effects.sql',
]);

async function applyDirection(databaseUrl, direction) {
  assertLocalDatabase(databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const files = direction === 'down' ? DOWN_MIGRATIONS : UP_MIGRATIONS;
    for (const file of files) {
      await applyMigration(pool, file, direction === 'down' ? 'down' : 'up');
    }
  } finally {
    await pool.end();
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const direction = process.argv[2] || 'up';
  applyDirection(process.env.DATABASE_URL, direction).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
