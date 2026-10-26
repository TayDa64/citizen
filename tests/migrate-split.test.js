import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { DOWN_MIGRATIONS, UP_MIGRATIONS, splitMigration } from '../server/migrate.js';

test('splits migrate:up and migrate:down sections', () => {
  const parts = splitMigration('-- intro\n-- migrate:up\nSELECT 1;\n-- migrate:down\nSELECT 2;\n');
  assert.match(parts.up, /SELECT 1;/);
  assert.doesNotMatch(parts.up, /SELECT 2/);
  assert.match(parts.down, /SELECT 2;/);
  assert.doesNotMatch(parts.down, /SELECT 1/);
});

test('treats a marker-less file as up-only', () => {
  const parts = splitMigration('CREATE TABLE example (id int);\n');
  assert.match(parts.up, /CREATE TABLE example/);
  assert.equal(parts.down.trim(), '');
});

test('slice 2 migration is additive and reversible in source', () => {
  const sql = fs.readFileSync('migrations/002_real_world_trigger_effects.sql', 'utf8');
  const parts = splitMigration(sql);
  assert.match(parts.up, /talent_cost/);
  assert.match(parts.up, /trigger_type/);
  assert.match(parts.up, /trigger_id/);
  assert.match(parts.down, /DROP COLUMN IF EXISTS talent_cost/);
  assert.match(parts.down, /DROP COLUMN IF EXISTS trigger_id/);
  assert.doesNotMatch(parts.up, /DROP TABLE/i);
  assert.doesNotMatch(parts.down, /DROP TABLE/i);
});

test('initial schema file is unchanged', () => {
  const diff = fs.readFileSync('migrations/001_initial_schema.sql', 'utf8');
  assert.match(diff, /CREATE TABLE real_world_triggers/);
  assert.doesNotMatch(diff, /talent_cost/);
  assert.doesNotMatch(diff, /trigger_type/);
  assert.doesNotMatch(diff, /client_id/);
});

test('migration 003 is additive and reversible in source', () => {
  const sql = fs.readFileSync('migrations/003_trigger_contract_v1.sql', 'utf8');
  const parts = splitMigration(sql);
  assert.match(parts.up, /client_id/);
  assert.match(parts.up, /news_spike/);
  assert.match(parts.up, /'news', 'market', 'talent', 'policy'/);
  assert.match(parts.up, /hype_baseline/);
  assert.match(parts.up, /talent_cost_baseline/);
  assert.match(parts.down, /DROP COLUMN IF EXISTS client_id/);
  assert.match(parts.down, /DROP COLUMN IF EXISTS hype_baseline/);
  assert.match(parts.down, /'news', 'market', 'talent', 'policy'/);
  assert.doesNotMatch(parts.up, /DROP TABLE/i);
  assert.doesNotMatch(parts.down, /DROP TABLE/i);
  assert.deepEqual(UP_MIGRATIONS, [
    'migrations/001_initial_schema.sql',
    'migrations/002_real_world_trigger_effects.sql',
    'migrations/003_trigger_contract_v1.sql'
  ]);
  assert.deepEqual(DOWN_MIGRATIONS, [
    'migrations/003_trigger_contract_v1.sql',
    'migrations/002_real_world_trigger_effects.sql'
  ]);
});
