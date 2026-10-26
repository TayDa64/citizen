import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalDatabase } from '../server/database.js';

test('refuses a non-local database host without connecting', () => {
  const started = Date.now();
  assert.throws(
    () => assertLocalDatabase('postgres://user:secret@db.internal.example:5432/citizen'),
    /non-local/
  );
  assert.ok(Date.now() - started < 200);
});

test('allows loopback hosts and the local postgres socket', () => {
  assert.doesNotThrow(() => assertLocalDatabase('postgres://localhost/citizen_slice2_test'));
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgres://127.0.0.1:5432/citizen_slice2_test')
  );
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql:///citizen_slice2_test?host=/var/run/postgresql')
  );
});
