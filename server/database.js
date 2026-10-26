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
  const bracketed = value.match(/^\[(.+)]$/);
  return bracketed ? bracketed[1] : value;
}

function rejectEdgeWhitespace(value) {
  if (typeof value === 'string' && value.length > 0 && value !== value.trim()) {
    throw new Error('Refusing database host with surrounding whitespace');
  }
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
  for (const value of [...queryHosts, ...queryAddrs]) {
    rejectEdgeWhitespace(value);
  }
  if (queryHosts.length > 1 || queryAddrs.length > 1) {
    throw new Error('Refusing repeated host parameter in database connection string');
  }
  // pg-connection-string lets ?host= replace the authority. A loopback
  // authority plus one absolute socket path is still that socket. Any other
  // second host is a repeat, including a remote value in either position.
  const socketOverride = queryHosts.length === 1
    && queryHosts[0].startsWith('/')
    && !queryHosts[0].includes('\0')
    && isLoopbackAuthority(url.hostname);
  if (url.hostname && queryHosts.length > 0 && !socketOverride) {
    throw new Error('Refusing repeated host parameter in database connection string');
  }
}

function isLoopbackAuthority(hostname) {
  const bare = hostname.replace(/^\[(.+)]$/, '$1');
  return LOOPBACK_NAMES.has(bare.toLowerCase());
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

  rejectEdgeWhitespace(config.host);
  rejectEdgeWhitespace(config.hostaddr);
  const parsedHost = unwrapHost(config.host || '');
  const parsedAddr = unwrapHost(config.hostaddr || '');
  if (parsedHost.includes(',') || parsedAddr.includes(',')) {
    throw new Error('Refusing multi-host database connection string');
  }
  if (parsedAddr && !isLocalHost(parsedAddr)) refuse(parsedAddr);

  const envAddrRaw = process.env.PGHOSTADDR || '';
  rejectEdgeWhitespace(envAddrRaw);
  const envAddr = unwrapHost(envAddrRaw);
  if (envAddr && !isLocalHost(envAddr)) refuse(envAddr);

  let effective = parsedHost;
  if (!effective) {
    const envHost = process.env.PGHOST || 'localhost';
    rejectEdgeWhitespace(envHost);
    effective = unwrapHost(envHost);
  }
  if (!isLocalHost(effective)) refuse(effective || '(empty)');
}
