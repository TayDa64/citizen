/**
 * CIT-67 — fixture ingest `--once` CLI.
 * Calls existing ingestAndPersist (which writes ingest_runs). No in-process cron.
 * Stdout prints CivicBrief-style `changed=true|false`. Actions: workflow_dispatch docs only.
 */

import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { assertLocalDatabase } from './database.js';
import { ingestAndPersist } from './eventIngest.js';
import { listFixtureIds } from '../src/adapters/fixtureAdapter.js';

export const DEFAULT_INGEST_FIXTURE_ID = 'civic-wage-bulletin';

/**
 * Resolve fixture id: --fixture CLI flag, then INGEST_FIXTURE_ID, then default.
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveFixtureId(argv, env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  let fromFlag = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--fixture' || arg === '--fixture-id') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error(`${arg} requires a non-empty fixture id`);
        error.code = 'invalid_fixture_flag';
        throw error;
      }
      fromFlag = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--fixture=') || arg.startsWith('--fixture-id=')) {
      const value = arg.slice(arg.indexOf('=') + 1).trim();
      if (!value) {
        const error = new Error(`${arg.split('=')[0]} requires a non-empty fixture id`);
        error.code = 'invalid_fixture_flag';
        throw error;
      }
      fromFlag = value;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      const error = new Error('help');
      error.code = 'help';
      throw error;
    }
    if (arg.startsWith('-')) {
      const error = new Error(`Unknown flag: ${arg}`);
      error.code = 'unknown_flag';
      throw error;
    }
  }

  const fromEnv =
    typeof env.INGEST_FIXTURE_ID === 'string' && env.INGEST_FIXTURE_ID.trim() !== ''
      ? env.INGEST_FIXTURE_ID.trim()
      : null;

  const fixtureId = fromFlag ?? fromEnv ?? DEFAULT_INGEST_FIXTURE_ID;
  const known = listFixtureIds();
  if (!known.includes(fixtureId)) {
    const error = new Error(
      `Unknown fixtureId "${fixtureId}". Must be one of: ${known.join(', ')}`,
    );
    error.code = 'unknown_fixture';
    throw error;
  }
  return fixtureId;
}

/** CivicBrief-style single-token change signal for workflow parsers. */
export function formatChangedLine(changed) {
  return `changed=${changed ? 'true' : 'false'}`;
}

/**
 * Run one fixture ingest against an existing pool (audit row via ingestAndPersist).
 * @returns {Promise<{ fixtureId: string, changed: boolean, triggers: object[], events: object[], adapter: string }>}
 */
export async function runIngestOnce(pool, { fixtureId = DEFAULT_INGEST_FIXTURE_ID } = {}) {
  const result = await ingestAndPersist(pool, {
    adapter: 'fixture',
    fixtureId,
  });
  // Match CIT-68 ingest_runs.changed: true when at least one trigger was persisted.
  const changed = result.triggers.length > 0;
  return {
    adapter: result.adapter,
    fixtureId: result.fixtureId,
    events: result.events,
    triggers: result.triggers,
    changed,
  };
}

export function helpText() {
  return [
    'Usage: npm run ingest:once -- [--fixture <id>]',
    '',
    `Default fixture: ${DEFAULT_INGEST_FIXTURE_ID}`,
    'Override with --fixture / --fixture-id or env INGEST_FIXTURE_ID.',
    'Requires DATABASE_URL pointing at local Postgres (migrations applied).',
    'Stdout: changed=true|false (CivicBrief botResult shape).',
    'Writes ingest_runs via ingestAndPersist. No campaign restack (CIT-69).',
    'GitHub Actions: workflow_dispatch only for now — do not add schedule: yet.',
  ].join('\n');
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let fixtureId;
  try {
    fixtureId = resolveFixtureId(argv, env);
  } catch (error) {
    if (error?.code === 'help') {
      console.log(helpText());
      return 0;
    }
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  }

  const databaseUrl = env.DATABASE_URL;
  try {
    assertLocalDatabase(databaseUrl);
  } catch (error) {
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  try {
    const result = await runIngestOnce(pool, { fixtureId });
    console.log(formatChangedLine(result.changed));
    return 0;
  } catch (error) {
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  } finally {
    await pool.end();
  }
}

if (isDirectRun()) {
  main().then((code) => {
    process.exit(code);
  });
}

export { main as runIngestOnceCli };
