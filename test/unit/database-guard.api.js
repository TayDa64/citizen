import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalDatabase } from '../../server/database.js';

function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('refuses a certificate path before the parser can read it', () => {
  assert.throws(
    () => assertLocalDatabase('postgresql://localhost/citizen?sslrootcert=/etc/passwd'),
    /certificate files/
  );
});

test('refuses a non-local database host without connecting', () => {
  const started = Date.now();
  assert.throws(
    () => assertLocalDatabase('postgres://user:secret@db.internal.example:5432/citizen'),
    /non-local/
  );
  assert.ok(Date.now() - started < 200);
});

test('refuses duplicate host params and a remote host in last position', () => {
  const started = Date.now();
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgresql:///citizen?host=/var/run/postgresql&host=/var/run/postgresql'
      ),
    /repeated host/
  );
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgresql:///citizen?host=/var/run/postgresql&host=db.internal.example'
      ),
    /repeated host/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql://localhost/citizen?host=db.internal.example'),
    /repeated host/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql:///citizen?host=localhost,db.internal.example'),
    /multi-host/
  );
  assert.throws(
    () => assertLocalDatabase('postgres://localhost,db.internal.example/citizen'),
    /multi-host/
  );
  assert.ok(Date.now() - started < 200);
});

test('allows a loopback URL host with one absolute socket host param', () => {
  const started = Date.now();
  for (const authority of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) {
    assert.doesNotThrow(() =>
      assertLocalDatabase(`postgres://${authority}/x?host=/var/run/postgresql`)
    );
  }
  assert.throws(
    () => assertLocalDatabase('postgres://localhost/x?host=db.internal.example'),
    /repeated host/
  );
  assert.throws(
    () => assertLocalDatabase('postgres://localhost/x?host=127.0.0.1'),
    /repeated host/
  );
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgres://localhost/x?host=/var/run/postgresql&host=/tmp/pg.sock'
      ),
    /repeated host/
  );
  assert.throws(
    () => assertLocalDatabase('postgres://db.internal.example/x?host=/var/run/postgresql'),
    /repeated host/
  );
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgres://localhost/x?host=/var/run/postgresql&hostaddr=127.0.0.1&hostaddr=::1'
      ),
    /repeated host/
  );
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgres://localhost/x?host=/var/run/postgresql&hostaddr=10.1.2.3'
      ),
    /non-local/
  );
  assert.ok(Date.now() - started < 200);
});

test('rejects surrounding whitespace on the host pg would use', () => {
  const started = Date.now();
  assert.throws(
    () => assertLocalDatabase('postgresql:///citizen?host=%20/var/run/postgresql'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql%20'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql:///citizen?host=%20localhost'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql://%20localhost/citizen'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql://localhost%20/citizen'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql:// localhost/citizen'),
    /whitespace/
  );
  assert.throws(
    () => assertLocalDatabase('postgresql://localhost/citizen?hostaddr=%20127.0.0.1'),
    /whitespace/
  );
  withEnv('PGHOST', ' localhost', () => {
    assert.throws(() => assertLocalDatabase('postgresql:///citizen'), /whitespace/);
    assert.doesNotThrow(() => assertLocalDatabase('postgres://127.0.0.1/citizen'));
  });
  withEnv('PGHOST', 'localhost ', () => {
    assert.throws(() => assertLocalDatabase('postgresql:///citizen'), /whitespace/);
  });
  withEnv('PGHOSTADDR', ' 127.0.0.1', () => {
    assert.throws(() => assertLocalDatabase('postgres://localhost/citizen'), /whitespace/);
  });
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql')
  );
  withEnv('PGHOST', 'localhost', () => {
    assert.doesNotThrow(() => assertLocalDatabase('postgresql:///citizen'));
  });
  assert.ok(Date.now() - started < 200);
});

test('allows loopback hosts, bracketed IPv6, and the local postgres socket', () => {
  assert.doesNotThrow(() => assertLocalDatabase('postgres://localhost/citizen_slice2_test'));
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgres://127.0.0.1:5432/citizen_slice2_test')
  );
  assert.doesNotThrow(() => assertLocalDatabase('postgres://[::1]/citizen_slice2_test'));
  assert.doesNotThrow(() => assertLocalDatabase('postgres://[::1]:5432/citizen_slice2_test'));
  assert.doesNotThrow(() => assertLocalDatabase('postgresql:///citizen_slice2_test?host=::1'));
  assert.doesNotThrow(() => assertLocalDatabase('postgresql:///citizen_slice2_test?host=[::1]'));
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql:///citizen_slice2_test?host=/var/run/postgresql')
  );
  assert.doesNotThrow(() => assertLocalDatabase('/var/run/postgresql'));
});

test('refuses a remote hostaddr and honors PGHOST only when host is omitted', () => {
  assert.throws(
    () => assertLocalDatabase('postgresql://localhost/citizen?hostaddr=10.1.2.3'),
    /non-local/
  );
  assert.throws(
    () =>
      assertLocalDatabase(
        'postgresql:///citizen?host=/var/run/postgresql&hostaddr=10.1.2.3'
      ),
    /non-local/
  );
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql://localhost/citizen?hostaddr=127.0.0.1')
  );
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql&hostaddr=::1')
  );
  assert.doesNotThrow(() =>
    assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql&hostaddr=[::1]')
  );

  withEnv('PGHOST', 'db.internal.example', () => {
    assert.throws(() => assertLocalDatabase('postgresql:///citizen'), /non-local/);
    assert.doesNotThrow(() => assertLocalDatabase('postgres://127.0.0.1/citizen'));
    assert.doesNotThrow(() =>
      assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql')
    );
  });
  withEnv('PGHOST', '/var/run/postgresql', () => {
    assert.doesNotThrow(() => assertLocalDatabase('postgresql:///citizen'));
  });
  withEnv('PGHOST', '::1', () => {
    assert.doesNotThrow(() => assertLocalDatabase('postgresql:///citizen'));
  });
  withEnv('PGHOSTADDR', '10.9.8.7', () => {
    assert.throws(
      () => assertLocalDatabase('postgresql:///citizen?host=/var/run/postgresql'),
      /non-local/
    );
  });
  withEnv('PGHOSTADDR', '127.0.0.1', () => {
    assert.doesNotThrow(() => assertLocalDatabase('postgres://localhost/citizen'));
  });
});
