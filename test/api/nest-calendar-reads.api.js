import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { startServer } from '../../server/index.js';
import { seedPhaseAFromMvCouncilFixture } from '../../server/scheduledMeetings.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migrateAll(pool) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
  }
}

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await migrateAll(db.pool);
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  return db;
}

describe('CIT-116 nest + calendar read APIs', { concurrency: 1, timeout: 120_000 }, () => {
  test('GET /api/jurisdictions: mv chain binds; sunnyvale peer does not', async () => {
    const db = await migratedDatabase();
    const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const listed = await fetch(`${base}/api/jurisdictions?home=mv`);
      assert.equal(listed.status, 200);
      const nest = await listed.json();
      assert.equal(nest.homeId, 'mv');
      assert.equal(nest.homeKnown, true);
      assert.deepEqual(
        nest.chain.map((row) => [row.id, row.bindsHome]),
        [
          ['mv', true],
          ['sc_county', true],
          ['ca', true],
          ['us', true],
        ],
      );
      assert.equal(nest.peers.length, 1);
      assert.equal(nest.peers[0].id, 'sunnyvale');
      assert.equal(nest.peers[0].bindsHome, false);
      assert.equal(
        nest.jurisdictions.find((row) => row.id === 'sunnyvale').bindsHome,
        false,
      );

      const unknown = await (await fetch(`${base}/api/jurisdictions?home=not-real`)).json();
      assert.equal(unknown.homeKnown, false);
      assert.deepEqual(unknown.chain, []);
      assert.deepEqual(unknown.peers, []);

      const method = await fetch(`${base}/api/jurisdictions`, { method: 'POST' });
      assert.equal(method.status, 405);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    }
  });

  test('GET /api/scheduled-meetings lists persisted rows; asOf marks due; empty when none', async () => {
    const db = await migratedDatabase();
    const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const empty = await fetch(`${base}/api/scheduled-meetings?jurisdictionId=mv`);
      assert.equal(empty.status, 200);
      assert.deepEqual(await empty.json(), []);

      const seeded = await seedPhaseAFromMvCouncilFixture(db.pool);
      assert.ok(seeded.upserted.length >= 1);

      const listed = await fetch(
        `${base}/api/scheduled-meetings?jurisdictionId=mv&limit=20&asOf=2099-01-01T00:00:00.000Z`,
      );
      assert.equal(listed.status, 200);
      const rows = await listed.json();
      assert.ok(rows.length >= 1);
      assert.equal(rows.every((row) => row.jurisdictionId === 'mv'), true);
      assert.ok(rows.every((row) => typeof row.id === 'string'));
      assert.ok(rows.every((row) => row.phase === 'A' || row.phase === 'B' || row.phase === 'C'));
      assert.equal(rows.some((row) => row.due === true), true);
      assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'externalEventId'), true);

      const method = await fetch(`${base}/api/scheduled-meetings`, { method: 'POST' });
      assert.equal(method.status, 405);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    }
  });
});
