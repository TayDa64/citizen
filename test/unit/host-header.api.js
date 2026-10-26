import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import config from '../../vite.config.js';
import { classifyHostHeader, isAllowedHostHeader, startServer } from '../../server/index.js';

function rawExchange(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const [head, body = ''] = text.split('\r\n\r\n');
      const status = Number(head.split('\r\n', 1)[0].split(' ')[1]);
      resolve({ status, body });
    });
  });
}

function request({ port, hostHeader, path = '/no-such', method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (hostHeader !== undefined) headers.Host = hostHeader;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        setHost: hostHeader === undefined,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('Host allowlist matches only loopback names on the bound port', () => {
  assert.equal(isAllowedHostHeader('127.0.0.1:8787', 8787), true);
  assert.equal(isAllowedHostHeader('localhost:8787', 8787), true);
  assert.equal(isAllowedHostHeader('LOCALHOST:8787', 8787), true);
  assert.equal(isAllowedHostHeader('[::1]:8787', 8787), true);
  assert.equal(isAllowedHostHeader('evil.example:8787', 8787), false);
  assert.equal(isAllowedHostHeader('localhost:5173', 8787), false);
  assert.equal(isAllowedHostHeader('localhost', 8787), false);
  assert.equal(isAllowedHostHeader(' 127.0.0.1:8787', 8787), false);
  assert.equal(isAllowedHostHeader('127.0.0.1:8787 ', 8787), false);
  assert.equal(isAllowedHostHeader(undefined, 8787), false);
  assert.equal(isAllowedHostHeader('127.0.0.1:8787', 0), false);
});

test('the API rejects a rebinding Host and still answers loopback names', async () => {
  const server = await startServer({ pool: null, port: 0, host: '127.0.0.1' });
  try {
    const port = server.address().port;
    const forbidden = [
      'evil.example',
      `evil.example:${port}`,
      'localhost:5173',
      '127.0.0.1:1',
      'localhost',
      `localhost:${port}.evil.example`,
      `0.0.0.0:${port}`,
      `[::]:${port}`
    ];
    for (const hostHeader of forbidden) {
      const response = await request({ port, hostHeader });
      assert.equal(response.status, 403, hostHeader);
      assert.deepEqual(JSON.parse(response.body), { error: 'Forbidden host' });
    }

    const missing = await rawExchange(
      port,
      `GET /no-such HTTP/1.1\r\nConnection: close\r\n\r\n`
    );
    assert.equal(missing.status, 400);

    const http10 = await rawExchange(port, `GET /no-such HTTP/1.0\r\n\r\n`);
    assert.equal(http10.status, 400);
    assert.deepEqual(JSON.parse(http10.body), { error: 'Host required' });

    const http10Allowed = await rawExchange(
      port,
      `GET /no-such HTTP/1.0\r\nHost: 127.0.0.1:${port}\r\n\r\n`
    );
    assert.equal(http10Allowed.status, 404);

    const duplicate = await rawExchange(
      port,
      `GET /no-such HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`
    );
    assert.equal(duplicate.status, 400);
    assert.deepEqual(JSON.parse(duplicate.body), { error: 'Duplicate host' });

    const swapped = await rawExchange(
      port,
      `GET /no-such HTTP/1.1\r\nhost: evil.example\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`
    );
    assert.equal(swapped.status, 400);
    assert.deepEqual(JSON.parse(swapped.body), { error: 'Duplicate host' });

    const options = await request({
      port,
      hostHeader: 'evil.example',
      path: '/api/triggers',
      method: 'OPTIONS'
    });
    assert.equal(options.status, 403);

    for (const name of ['127.0.0.1', 'localhost', '[::1]', 'LOCALHOST']) {
      const response = await request({ port, hostHeader: `${name}:${port}` });
      assert.equal(response.status, 404, name);
      assert.deepEqual(JSON.parse(response.body), { error: 'Not found' });
    }

    const implicit = await request({ port, path: '/no-such' });
    assert.equal(implicit.status, 404);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

test('the Vite /api proxy rewrites Host to the loopback API', () => {
  const proxy = config.server.proxy['/api'];
  assert.equal(proxy.target, 'http://127.0.0.1:8787');
  assert.equal(proxy.changeOrigin, true);
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /127\.0\.0\.1:8787/);
  assert.match(readme, /non-default `PORT`/);
  assert.match(readme, /proxy `target`/);
});

test('a missing Host is 400 and a repeated Host is 400', () => {
  assert.deepEqual(
    classifyHostHeader({ hostHeader: undefined, rawHeaders: [], port: 8787 }),
    { status: 400, error: 'Host required' }
  );
  assert.deepEqual(
    classifyHostHeader({
      hostHeader: '127.0.0.1:8787',
      rawHeaders: ['Host', '127.0.0.1:8787', 'Host', 'evil.example'],
      port: 8787
    }),
    { status: 400, error: 'Duplicate host' }
  );
  assert.equal(
    classifyHostHeader({
      hostHeader: '127.0.0.1:8787',
      rawHeaders: ['Host', '127.0.0.1:8787'],
      port: 8787
    }),
    null
  );
});
