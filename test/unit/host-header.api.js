import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import config from '../../vite.config.js';
import { isAllowedHostHeader, startServer } from '../../server/index.js';

function rawStatus(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('end', () => {
      const statusLine = Buffer.concat(chunks).toString('utf8').split('\r\n', 1)[0];
      const status = Number(statusLine.split(' ')[1]);
      resolve(status);
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

    const missing = await rawStatus(
      port,
      `GET /no-such HTTP/1.1\r\nConnection: close\r\n\r\n`
    );
    assert.equal(missing, 400);

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
});
