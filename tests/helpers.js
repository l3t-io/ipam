'use strict';

// Starts the real server as a separate process with an empty data folder.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'app', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'l3t-ipam-test-'));

async function startServer({ env = {}, dataDir = tempDir() } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      IPAM_DATA: dataDir,
      IPAM_PORT: String(port),
      IPAM_HOST: '127.0.0.1',
      IPAM_AUTH_FAIL_DELAY_MS: '0',
      IPAM_LANG: 'de', // the tests check German log lines
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (c) => { logs += c; });
  child.stderr.on('data', (c) => { logs += c; });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Server startet nicht:\n${logs}`)), 10000);
    const check = () => { if (logs.includes('laeuft auf')) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check);
    child.on('exit', (c) => { clearTimeout(t); reject(new Error(`Server beendet (${c}):\n${logs}`)); });
  });

  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    dataDir,
    get logs() { return logs; },
    setupCode() {
      const m = logs.match(/Einrichtungscode ein Konto anlegen:\s+([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})/);
      return m && m[1];
    },
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill();
      });
    },
  };
}

// fetch with an optional cookie and the mandatory header for writing calls.
async function req(base, method, pathname, { body, cookie, headers = {}, csrf = true } = {}) {
  const h = { ...headers };
  if (csrf) h['X-IPAM-Request'] = '1';
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(base + pathname, {
    method, headers: h, redirect: 'manual',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, headers: res.headers, json, text, setCookie, cookie: setCookie.split(';')[0] };
}

module.exports = { startServer, req, tempDir };
