import http from 'node:http';
import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { assertLocalDatabase } from './database.js';
import { createTrigger, listCompanies, listTriggers } from './triggers.js';
import {
  mockTriggerPayload,
  TriggerValidationError,
  validateMockRequest
} from '../src/triggerContract.js';

const MAX_BODY_BYTES = 16 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

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
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin || 'http://127.0.0.1:5173',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  if (
    pathname === '/api/triggers' ||
    pathname === '/api/triggers/mock' ||
    pathname === '/api/companies'
  ) {
    sendJson(res, 405, { error: 'Method not allowed', issues: [] }, origin);
    return;
  }
  sendJson(res, 404, { error: 'Not found' }, origin);
}

export function createServer(pool) {
  return http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res, pool);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      const message = status >= 500 ? 'Internal server error' : error.message;
      sendJson(res, status, { error: message, issues: error.issues || [] }, allowedOrigin(req));
    }
  });
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
