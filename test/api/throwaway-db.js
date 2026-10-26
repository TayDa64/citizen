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
