import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { assertLocalDatabase } from './database.js';
import {
  clearTriggers,
  createTrigger,
  deleteTrigger,
  listCompanies,
  listTriggers
} from './triggers.js';
import {
  commitTurn,
  createCampaign,
  getCampaign,
  listTurnCommits
} from './campaigns.js';
import { ingestAndPersist } from './eventIngest.js';
import {
  mockTriggerPayload,
  TriggerValidationError,
  validateMockRequest
} from '../src/triggerContract.js';
import { TurnCommandError } from '../src/turnEngine.js';

const MAX_BODY_BYTES = 16 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const HOST_HEADER_NAMES = ['localhost', '127.0.0.1', '[::1]'];

export function isAllowedHostHeader(hostHeader, port) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  if (hostHeader !== hostHeader.trim()) return false;
  if (!Number.isInteger(port) || port <= 0) return false;
  const value = hostHeader.toLowerCase();
  return HOST_HEADER_NAMES.some((name) => value === `${name}:${port}`);
}

export function classifyHostHeader({ hostHeader, rawHeaders, port }) {
  let hostCount = 0;
  if (Array.isArray(rawHeaders)) {
    for (let index = 0; index < rawHeaders.length; index += 2) {
      if (String(rawHeaders[index]).toLowerCase() === 'host') hostCount += 1;
    }
  }
  if (hostCount > 1) return { status: 400, error: 'Duplicate host' };
  if (hostHeader === undefined) return { status: 400, error: 'Host required' };
  if (!isAllowedHostHeader(hostHeader, port)) return { status: 403, error: 'Forbidden host' };
  return null;
}

function sendEmpty(res, status, origin) {
  const headers = { 'Cache-Control': 'no-store' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end();
}

function sendJson(res, status, body, origin) {
  const payload = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(payload);
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return origin;
  return null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        const error = new Error('Payload too large');
        error.status = 413;
        reject(error);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function parseJson(raw) {
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    error.issues = [{ path: '', code: 'invalid_json', message: 'Request body is not valid JSON' }];
    throw error;
  }
}

async function handleRequest(req, res, pool) {
  const origin = allowedOrigin(req);
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  const pathname = requestUrl.pathname;
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin || 'http://127.0.0.1:5173',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '600'
    });
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/api/triggers') {
    sendJson(res, 200, await listTriggers(pool), origin);
    return;
  }
  if (req.method === 'GET' && pathname === '/api/companies') {
    sendJson(res, 200, await listCompanies(pool), origin);
    return;
  }
  if (req.method === 'DELETE' && pathname === '/api/triggers') {
    await clearTriggers(pool);
    sendEmpty(res, 204, origin);
    return;
  }
  const triggerPath = pathname.match(/^\/api\/triggers\/([^/]+)$/);
  if (req.method === 'DELETE' && triggerPath && triggerPath[1] !== 'mock' && triggerPath[1] !== 'ingest') {
    let id;
    try {
      id = decodeURIComponent(triggerPath[1]);
    } catch {
      const error = new Error('Invalid trigger id');
      error.status = 400;
      error.issues = [{ path: 'id', code: 'invalid_value', message: 'id is not valid URL encoding' }];
      throw error;
    }
    await deleteTrigger(pool, id);
    sendEmpty(res, 204, origin);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/triggers/ingest') {
    const raw = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    if (raw.trim() && !contentType.includes('application/json')) {
      const error = new Error('Content-Type must be application/json');
      error.status = 415;
      throw error;
    }
    const parsed = raw.trim() ? parseJson(raw) : {};
    // Fixture / http-stub pipeline → contract triggers → createTrigger (replace, no compound).
    sendJson(res, 201, await ingestAndPersist(pool, parsed ?? {}), origin);
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/triggers' || pathname === '/api/triggers/mock')) {
    const raw = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      const error = new Error('Content-Type must be application/json');
      error.status = 415;
      throw error;
    }
    const parsed = parseJson(raw);
    if (pathname === '/api/triggers/mock') {
      const mock = validateMockRequest(parsed);
      if (!mock.ok) throw new TriggerValidationError('Invalid mock request', mock.issues);
      sendJson(res, 201, await createTrigger(pool, mockTriggerPayload(mock.scenario)), origin);
      return;
    }
    sendJson(res, 201, await createTrigger(pool, parsed), origin);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/campaigns') {
    const raw = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    if (raw.trim() && !contentType.includes('application/json')) {
      const error = new Error('Content-Type must be application/json');
      error.status = 415;
      throw error;
    }
    const parsed = raw.trim() ? parseJson(raw) : {};
    sendJson(res, 201, await createCampaign(pool, parsed ?? {}), origin);
    return;
  }

  const campaignPath = pathname.match(/^\/api\/campaigns\/([^/]+)$/);
  if (req.method === 'GET' && campaignPath) {
    let id;
    try {
      id = decodeURIComponent(campaignPath[1]);
    } catch {
      const error = new Error('Invalid campaign id');
      error.status = 400;
      error.issues = [{ path: 'id', code: 'invalid_value', message: 'id is not valid URL encoding' }];
      throw error;
    }
    sendJson(res, 200, await getCampaign(pool, id), origin);
    return;
  }

  const campaignTurnsPath = pathname.match(/^\/api\/campaigns\/([^/]+)\/turns$/);
  if (campaignTurnsPath) {
    let id;
    try {
      id = decodeURIComponent(campaignTurnsPath[1]);
    } catch {
      const error = new Error('Invalid campaign id');
      error.status = 400;
      error.issues = [{ path: 'id', code: 'invalid_value', message: 'id is not valid URL encoding' }];
      throw error;
    }
    if (req.method === 'GET') {
      const limitRaw = requestUrl.searchParams.get('limit');
      const limit = limitRaw == null ? 50 : Number(limitRaw);
      sendJson(res, 200, await listTurnCommits(pool, id, { limit }), origin);
      return;
    }
    if (req.method === 'POST') {
      const raw = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('application/json')) {
        const error = new Error('Content-Type must be application/json');
        error.status = 415;
        throw error;
      }
      const parsed = parseJson(raw);
      try {
        sendJson(res, 201, await commitTurn(pool, id, parsed), origin);
      } catch (error) {
        if (error instanceof TurnCommandError) throw error;
        throw error;
      }
      return;
    }
  }

  if (
    pathname === '/api/triggers' ||
    pathname === '/api/triggers/mock' ||
    pathname === '/api/triggers/ingest' ||
    pathname === '/api/companies' ||
    pathname === '/api/campaigns' ||
    /^\/api\/campaigns\/[^/]+$/.test(pathname) ||
    /^\/api\/campaigns\/[^/]+\/turns$/.test(pathname)
  ) {
    sendJson(res, 405, { error: 'Method not allowed', issues: [] }, origin);
    return;
  }
  sendJson(res, 404, { error: 'Not found' }, origin);
}

export function createServer(pool) {
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const hostProblem = classifyHostHeader({
      hostHeader: req.headers.host,
      rawHeaders: req.rawHeaders,
      port
    });
    if (hostProblem) {
      sendJson(res, hostProblem.status, { error: hostProblem.error });
      return;
    }
    try {
      await handleRequest(req, res, pool);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      const message = status >= 500 ? 'Internal server error' : error.message;
      sendJson(res, status, { error: message, issues: error.issues || [] }, allowedOrigin(req));
    }
  });
  return server;
}

export function startServer({ pool, port = 8787, host = '127.0.0.1' }) {
  if (!LOOPBACK_HOSTS.has(host)) {
    return Promise.reject(new Error('API server binds to loopback only'));
  }
  const server = createServer(pool);
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    assertLocalDatabase(databaseUrl);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  startServer({
    pool,
    port: Number(process.env.PORT) || 8787
  })
    .then((server) => {
      const address = server.address();
      console.log(`Citizen API listening on 127.0.0.1:${address.port}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
