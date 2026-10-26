export function assertLocalDatabase(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required and must point at a local Postgres');
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  const hostname = url.hostname;
  const hostParam = url.searchParams.get('host');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const socket = typeof hostParam === 'string' && hostParam.startsWith('/') && !hostParam.includes('\0');
  if (socket && (hostname === '' || loopback)) return;
  if (loopback && (hostParam == null || socket)) return;
  const shown = hostname || hostParam || '(empty)';
  throw new Error(`Refusing non-local database host "${shown}"`);
}
