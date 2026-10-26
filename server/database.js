import parseConnectionString from 'pg-connection-string';

// node-pg resolves a connection string with pg-connection-string, then
// ConnectionParameters.host = parsed host, or PGHOST, or "localhost".
// Duplicate ?host= params collapse to the last value. URLSearchParams.get
// returns the first, so the guard has to follow parse(), not the URL class.
// hostaddr and PGHOSTADDR are libpq address overrides. node-pg does not read
// them today; a non-local value is still refused so this string and
// environment cannot name a remote address.

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

function unwrapHost(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const bracketed = trimmed.match(/^\[(.+)]$/);
  return bracketed ? bracketed[1] : trimmed;
}

function isLocalHost(value) {
  const host = unwrapHost(value);
  if (!host || host.includes('\0') || host.includes(',') || /\s/.test(host)) return false;
  if (host.startsWith('/')) return true;
  return LOOPBACK_NAMES.has(host.toLowerCase());
}

function assertNoRepeatedHost(connectionString) {
  if (connectionString.startsWith('/')) return;
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return;
  }
  const queryHosts = url.searchParams.getAll('host');
  const queryAddrs = url.searchParams.getAll('hostaddr');
  if (queryHosts.length > 1 || queryAddrs.length > 1 || (url.hostname && queryHosts.length > 0)) {
    throw new Error('Refusing repeated host parameter in database connection string');
  }
}

function refuse(host) {
  throw new Error(`Refusing non-local database host "${host}"`);
}

export function assertLocalDatabase(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required and must point at a local Postgres');
  }
  if (/sslcert|sslkey|sslrootcert/i.test(connectionString)) {
    throw new Error('Refusing database connection string that reads certificate files');
  }
  assertNoRepeatedHost(connectionString);

  let config;
  try {
    config = parseConnectionString(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  const parsedHost = unwrapHost(config.host || '');
  const parsedAddr = unwrapHost(config.hostaddr || '');
  if (parsedHost.includes(',') || parsedAddr.includes(',')) {
    throw new Error('Refusing multi-host database connection string');
  }
  if (parsedAddr && !isLocalHost(parsedAddr)) refuse(parsedAddr);

  const envAddr = unwrapHost(process.env.PGHOSTADDR || '');
  if (envAddr && !isLocalHost(envAddr)) refuse(envAddr);

  let effective = parsedHost;
  if (!effective) {
    effective = unwrapHost(process.env.PGHOST || 'localhost');
  }
  if (!isLocalHost(effective)) refuse(effective || '(empty)');
}
