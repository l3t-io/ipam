'use strict';

// Regression tests for the findings of the security review (1.14.4).

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, req } = require('./helpers');

const PASS = 'korrekt-pferd-batterie';

async function mitRollen() {
  const srv = await startServer();
  const admin = (await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: PASS } })).cookie;
  await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'anna', role: 'bearbeiter', password: 'langes-passwort-1' } });
  await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'gast', role: 'leser', password: 'langes-passwort-2' } });
  const login = async (user, password) => (await req(srv.base, 'POST', '/api/auth/login', { body: { user, password } })).cookie;
  return { srv, admin, anna: await login('anna', 'langes-passwort-1'), gast: await login('gast', 'langes-passwort-2') };
}

describe('H1: permission check cannot be bypassed via path variants', () => {
  let r;
  before(async () => { r = await mitRollen(); });
  after(() => r.srv.stop());

  test('variants with a trailing slash or a double slash are unknown', async () => {
    const leer = { vlans: [], hosts: [] };
    for (const [method, pfad, body] of [
      ['POST', '/api/import/', leer], ['POST', '/api//import', leer],
      ['PUT', '/api/unifi/offline/', { auto: true, tage: 1 }], ['POST', '/api/unifi/offline/run/', undefined],
      ['PUT', '/api/unifi/config/', { url: 'http://127.0.0.1:1', key: 'x' }], ['POST', '/api/unifi/test/', { url: 'http://127.0.0.1:1', key: 'x' }],
      ['GET', '/api/unifi/config/', undefined], ['GET', '/api//unifi/config', undefined],
    ]) {
      const a = await req(r.srv.base, method, pfad, { cookie: r.anna, body });
      assert.equal(a.status, 404, `${method} ${pfad}`);
    }
  });

  test('the canonical paths remain reserved for administrators', async () => {
    assert.equal((await req(r.srv.base, 'POST', '/api/import', { cookie: r.anna, body: { vlans: [], hosts: [] } })).status, 403);
    assert.equal((await req(r.srv.base, 'GET', '/api/unifi/config', { cookie: r.gast })).status, 403);
  });
});

describe('H2: IDs from an import cannot hit other endpoints', () => {
  test('dangerous IDs are replaced, references are kept, duplicates become unique', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const r = await req(srv.base, 'POST', '/api/import', { body: {
        vlans: [
          { id: '../users/abc', name: 'Server', cidr: '10.13.20.0/24', zone: 'x'.repeat(500), zoneAusUnifi: true, createdAt: { boese: 1 } },
          { id: 'doppelt', name: 'IoT', cidr: '10.30.0.0/24', color: 'x);display:none' },
          { id: 'doppelt', name: 'Gäste', cidr: '10.40.0.0/24' },
        ],
        hosts: [
          { id: '../unifi/config', vlanId: '../users/abc', ip: '10.13.20.10', hostname: 'nas' },
          { id: 'h-%2e%2e', vlanId: 'doppelt', ip: '10.30.0.5' },
        ],
      } });
      assert.equal(r.status, 200, r.text);
      const s = (await req(srv.base, 'GET', '/api/state')).json;
      for (const x of [...s.vlans, ...s.hosts]) assert.match(x.id, /^[A-Za-z0-9-]{1,64}$/, x.id);
      assert.equal(new Set(s.vlans.map((v) => v.id)).size, 3, 'IDs unique');
      const server = s.vlans.find((v) => v.name === 'Server');
      assert.equal(s.hosts.find((h) => h.hostname === 'nas').vlanId, server.id, 'host points to the right network');
      assert.equal(server.zone.length, 40, 'zone truncated');
      assert.ok(!Number.isNaN(Date.parse(server.createdAt)));
      assert.equal(s.vlans.find((v) => v.name === 'IoT').color, 'blau', 'unknown colour replaced');
    } finally { await srv.stop(); }
  });
});

describe('M1: UniFi account from the environment is never sent to another address', () => {
  test('after changing the address in the UI, no sign-in with the environment account', async () => {
    const gesehen = [];
    const fremd = http.createServer((q, s) => {
      let b = '';
      q.on('data', (c) => { b += c; });
      q.on('end', () => { gesehen.push(`${q.method} ${q.url} ${b}`); s.writeHead(401); s.end(); });
    });
    await new Promise((ok) => fremd.listen(0, '127.0.0.1', ok));
    const srv = await startServer({ env: {
      IPAM_AUTH: 'off', IPAM_UNIFI_URL: 'http://127.0.0.1:1', IPAM_UNIFI_USER: 'unifi-admin', IPAM_UNIFI_PASS: 'GeheimesUnifiPasswort',
    } });
    try {
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: `http://127.0.0.1:${fremd.address().port}`, key: 'beliebig', site: 'default' } });
      await req(srv.base, 'GET', '/api/unifi/status');
      assert.ok(gesehen.length > 0, 'the new controller was queried');
      assert.ok(!gesehen.some((g) => g.includes('GeheimesUnifiPasswort') || g.includes('/api/auth/login')), gesehen.join('\n'));
    } finally { await srv.stop(); await new Promise((ok) => fremd.close(ok)); }
  });
});

describe('M2: no global lockout, proxy headers only from trusted sources', () => {
  test('many failed attempts from many addresses do not lock out the correct password', async () => {
    const srv = await startServer({ env: { IPAM_USER: 'tony', IPAM_PASS: PASS, IPAM_TRUST_PROXY: '1' } });
    try {
      for (let i = 0; i < 105; i++) {
        await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': `203.0.113.${i % 250}` }, body: { user: 'tony', password: `falsch-${i}-xxxxxxxx` } });
      }
      const ok = await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': '198.51.100.9' }, body: { user: 'tony', password: PASS } });
      assert.equal(ok.status, 200);
    } finally { await srv.stop(); }
  });

  test('with a list of trusted proxies, a forged header does not count', async () => {
    const srv = await startServer({ env: { IPAM_USER: 'tony', IPAM_PASS: PASS, IPAM_TRUST_PROXY: '10.9.9.9, 172.16.0.0/12' } });
    try {
      for (let i = 0; i < 10; i++) {
        await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': `203.0.113.${i}` }, body: { user: 'tony', password: `falsch-${i}-xxxxxxxx` } });
      }
      const r = await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': '203.0.113.200' }, body: { user: 'tony', password: PASS } });
      assert.equal(r.status, 429, 'the real address (127.0.0.1) is locked, the header changes nothing');
      // Without a trusted proxy, no Secure cookie and no HSTS via header either
      const h = await req(srv.base, 'GET', '/login', { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.equal(h.headers.get('strict-transport-security'), null);
    } finally { await srv.stop(); }
  });

  test('behind a trusted proxy with HTTPS: HSTS', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off', IPAM_TRUST_PROXY: '127.0.0.1' } });
    try {
      const h = await req(srv.base, 'GET', '/login', { headers: { 'X-Forwarded-Proto': 'https' } });
      assert.match(h.headers.get('strict-transport-security') || '', /max-age=31536000/);
    } finally { await srv.stop(); }
  });
});

describe('Low', () => {
  test('N3: an account with many sign-ins only evicts its own sessions', async () => {
    const r = await mitRollen();
    try {
      const erste = r.gast;
      for (let i = 0; i < 25; i++) await req(r.srv.base, 'POST', '/api/auth/login', { body: { user: 'gast', password: 'langes-passwort-2' } });
      assert.equal((await req(r.srv.base, 'GET', '/api/state', { cookie: erste })).status, 401, 'oldest own session gone');
      assert.equal((await req(r.srv.base, 'GET', '/api/state', { cookie: r.admin })).status, 200, 'administrator stays signed in');
    } finally { await r.srv.stop(); }
  });

  test('N4: network colour only from the known list', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const v = await req(srv.base, 'POST', '/api/vlans', { body: { name: 'x', cidr: '10.0.0.0/24', color: 'x);display:none' } });
      assert.equal(v.json.color, 'blau');
      assert.equal((await req(srv.base, 'POST', '/api/vlans', { body: { name: 'y', cidr: '10.1.0.0/24', color: 'gruen' } })).json.color, 'gruen');
    } finally { await srv.stop(); }
  });

  test('N5: ordinary requests have a small size limit, the import does not', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const gross = await req(srv.base, 'POST', '/api/vlans', { body: { name: 'x', cidr: '10.0.0.0/24', notes: 'a'.repeat(100 * 1024) } });
      assert.equal(gross.status, 413);
      const hosts = Array.from({ length: 1500 }, (_, i) => ({ id: `h${i}`, vlanId: 'n1', ip: `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`, notes: 'x'.repeat(60) }));
      const imp = await req(srv.base, 'POST', '/api/import', { body: { vlans: [{ id: 'n1', name: 'gross', cidr: '10.0.0.0/16' }], hosts } });
      assert.equal(imp.status, 200, imp.text);
    } finally { await srv.stop(); }
  });

  test('N6: line breaks in the username do not forge log lines', async () => {
    const srv = await startServer({ env: { IPAM_USER: 'tony', IPAM_PASS: PASS } });
    try {
      await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'x\n2026-01-01T00:00:00.000Z Anmeldung: «tony» (admin)', password: 'falsch-falsch-1' } });
      assert.ok(!/\n2026-01-01T00:00:00\.000Z Anmeldung/.test(srv.logs));
    } finally { await srv.stop(); }
  });

  test('initial setup: two concurrent requests create only one account', async () => {
    const srv = await startServer();
    try {
      const code = srv.setupCode();
      const [a, b] = await Promise.all(['eins', 'zwei'].map((user) =>
        req(srv.base, 'POST', '/api/auth/setup', { body: { code, user, password: PASS } })));
      assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    } finally { await srv.stop(); }
  });
});
