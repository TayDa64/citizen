import pg from 'pg';

const SOCKET_HOST = '/var/run/postgresql';

function adminClient() {
  return new pg.Client({
    host: SOCKET_HOST,
    database: 'postgres'
  });
}

export async function createThrowawayDatabase() {
  const name = `citizen_slice2_test_${process.pid}_${Math.floor(Math.random() * 1_000_000_000)}`;
  if (!/^citizen_slice2_test_[0-9_]+$/.test(name)) {
    throw new Error(`Refusing unexpected database name ${name}`);
  }

  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({
    host: SOCKET_HOST,
    database: name,
    max: 4
  });
  // close() ends the pool and then drops the database WITH (FORCE). pg-pool's
  // Pool.end() resolves before the client sockets have actually closed, so the
  // FORCE drop can still terminate a backend that belongs to this pool. A pool
  // with no 'error' listener re-emits that as an uncaughtException and kills
  // the whole test file (27% of runs at 3x concurrency, seen in CI on run
  // 41130850224). Swallow only the expected admin termination 57P01; anything
  // else still reaches the process so real bugs are not hidden.
  pool.on('error', (err) => {
    if (err?.code === '57P01') return;
    throw err;
  });

  const located = await pool.query(
    'SELECT inet_server_addr()::text AS addr, current_database() AS db'
  );
  if (located.rows[0].db !== name) {
    await pool.end();
    throw new Error(`Connected to unexpected database ${located.rows[0].db}`);
  }
  if (located.rows[0].addr !== null) {
    await pool.end();
    throw new Error(`Refusing TCP database connection via ${located.rows[0].addr}`);
  }

  return {
    name,
    pool,
    async close() {
      await pool.end();
      const dropper = adminClient();
      await dropper.connect();
      try {
        await dropper.query(`DROP DATABASE ${name} WITH (FORCE)`);
      } finally {
        await dropper.end();
      }
    }
  };
}
