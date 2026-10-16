'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, req, tempDir } = require('./helpers');
const { hashPassword } = require('../app/auth');

const ADMIN_PASS = 'korrekt-pferd-batterie';
const login = async (base, user, password) => (await req(base, 'POST', '/api/auth/login', { body: { user, password } })).cookie;

describe('User management', () => {
  let srv;
  let admin;
  let ids = {};
  before(async () => {
    srv = await startServer();
    admin = (await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: ADMIN_PASS } })).cookie;
  });
  after(() => srv.stop());

  test('list shows the first account as administrator', async () => {
    const r = await req(srv.base, 'GET', '/api/users', { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.users.length, 1);
    assert.equal(r.json.users[0].role, 'admin');
    assert.equal(r.json.users[0].self, true);
    assert.ok(!r.text.includes('scrypt'), 'no hashes in the response');
    ids.tony = r.json.users[0].id;
  });

  test('create user, with validation of name, role and password', async () => {
    const neu = (body) => req(srv.base, 'POST', '/api/users', { cookie: admin, body });
    assert.equal((await neu({ user: 'anna', role: 'chef', password: 'langes-passwort-1' })).status, 400);
    assert.equal((await neu({ user: 'an na', role: 'leser', password: 'langes-passwort-1' })).status, 400);
    assert.equal((await neu({ user: 'anna', role: 'leser', password: 'kurz' })).status, 400);
    assert.equal((await neu({ user: 'TONY', role: 'leser', password: 'langes-passwort-1' })).status, 400, 'name is a duplicate ignoring case');

    const a = await neu({ user: 'anna', role: 'bearbeiter', password: 'langes-passwort-1' });
    assert.equal(a.status, 201);
    ids.anna = a.json.id;
    const b = await neu({ user: 'gast', role: 'leser', password: 'langes-passwort-2' });
    assert.equal(b.status, 201);
    ids.gast = b.json.id;
  });

  test('sign-in is case-insensitive for the name', async () => {
    assert.ok(await login(srv.base, 'Anna', 'langes-passwort-1'));
  });

  test('Read: view everything, change nothing, no administration', async () => {
    const c = await login(srv.base, 'gast', 'langes-passwort-2');
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: c })).status, 200);
    assert.equal((await req(srv.base, 'GET', '/api/auth/status', { cookie: c })).json.role, 'leser');
    const v = await req(srv.base, 'POST', '/api/vlans', { cookie: c, body: { vid: 1, name: 'x', cidr: '10.0.0.0/24' } });
    assert.equal(v.status, 403);
    assert.match(v.json.error, /Nur Lesezugriff/);
    assert.equal((await req(srv.base, 'POST', '/api/import', { cookie: c, body: { vlans: [], hosts: [] } })).status, 403);
    assert.equal((await req(srv.base, 'GET', '/api/users', { cookie: c })).status, 403);
    assert.equal((await req(srv.base, 'GET', '/api/unifi/config', { cookie: c })).status, 403);
    assert.equal((await req(srv.base, 'PATCH', '/api/settings', { cookie: c, body: { theme: 'dark' } })).status, 200, 'appearance yes');
  });

  test('Edit: maintaining the inventory yes, import, UniFi settings and users no', async () => {
    const c = await login(srv.base, 'anna', 'langes-passwort-1');
    assert.equal((await req(srv.base, 'POST', '/api/vlans', { cookie: c, body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24' } })).status, 201);
    assert.equal((await req(srv.base, 'POST', '/api/import', { cookie: c, body: { vlans: [], hosts: [] } })).status, 403);
    assert.equal((await req(srv.base, 'PUT', '/api/unifi/config', { cookie: c, body: { url: 'https://10.1.1.1', key: 'x' } })).status, 403);
    assert.equal((await req(srv.base, 'POST', '/api/users', { cookie: c, body: { user: 'x', role: 'admin', password: 'langes-passwort-9' } })).status, 403);
  });

  test('role change takes effect immediately, without signing in again', async () => {
    const c = await login(srv.base, 'gast', 'langes-passwort-2');
    assert.equal((await req(srv.base, 'PATCH', `/api/users/${ids.gast}`, { cookie: admin, body: { role: 'bearbeiter' } })).status, 200);
    assert.equal((await req(srv.base, 'POST', '/api/vlans', { cookie: c, body: { vid: 30, name: 'IoT', cidr: '10.30.0.0/24' } })).status, 201);
    await req(srv.base, 'PATCH', `/api/users/${ids.gast}`, { cookie: admin, body: { role: 'leser' } });
    assert.equal((await req(srv.base, 'POST', '/api/vlans', { cookie: c, body: { vid: 31, name: 'x', cidr: '10.31.0.0/24' } })).status, 403);
  });

  test('resetting the password ends the user\'s sessions', async () => {
    const c = await login(srv.base, 'gast', 'langes-passwort-2');
    const r = await req(srv.base, 'PATCH', `/api/users/${ids.gast}`, { cookie: admin, body: { password: 'ganz-neues-passwort' } });
    assert.equal(r.status, 200);
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: c })).status, 401);
    assert.ok(await login(srv.base, 'gast', 'ganz-neues-passwort'));
  });

  test('the last administrator remains, own account cannot be deleted', async () => {
    assert.equal((await req(srv.base, 'DELETE', `/api/users/${ids.tony}`, { cookie: admin })).status, 400);
    assert.equal((await req(srv.base, 'PATCH', `/api/users/${ids.tony}`, { cookie: admin, body: { role: 'leser' } })).status, 400);
    assert.equal((await req(srv.base, 'PATCH', `/api/users/${ids.tony}`, { cookie: admin, body: { password: 'anderes-passwort-x' } })).status, 400,
      'own password only with the old one under «Account»');
  });

  test('a second administrator may demote the first, but not the last', async () => {
    await req(srv.base, 'PATCH', `/api/users/${ids.anna}`, { cookie: admin, body: { role: 'admin' } });
    const anna = await login(srv.base, 'anna', 'langes-passwort-1');
    assert.equal((await req(srv.base, 'PATCH', `/api/users/${ids.tony}`, { cookie: anna, body: { role: 'bearbeiter' } })).status, 200);
    assert.equal((await req(srv.base, 'GET', '/api/users', { cookie: admin })).status, 403, 'tony is no longer an administrator');
    await req(srv.base, 'PATCH', `/api/users/${ids.tony}`, { cookie: anna, body: { role: 'admin' } });
  });

  test('deleting ends the sessions immediately', async () => {
    const c = await login(srv.base, 'gast', 'ganz-neues-passwort');
    assert.equal((await req(srv.base, 'DELETE', `/api/users/${ids.gast}`, { cookie: admin })).status, 200);
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: c })).status, 401);
    assert.equal((await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'gast', password: 'ganz-neues-passwort' } })).status, 401);
  });

  test('users and sessions survive a restart', async () => {
    const { dataDir } = srv;
    await srv.stop();
    srv = await startServer({ dataDir });
    const r = await req(srv.base, 'GET', '/api/users', { cookie: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.users.map((u) => [u.user, u.role]).sort(), [['anna', 'admin'], ['tony', 'admin']]);
    assert.ok(r.json.users.find((u) => u.user === 'tony').lastLogin);
  });
});

describe('Migration from 1.6', () => {
  test('previous single account becomes administrator, session stays valid', async () => {
    const dataDir = tempDir();
    const hash = await hashPassword(ADMIN_PASS);
    fs.writeFileSync(path.join(dataDir, 'auth.json'), JSON.stringify({ version: 1, user: 'tony', hash, changedAt: '2026-10-15T08:00:00Z' }));
    // Session in the 1.6 format: username only, no uid
    const crypto = require('node:crypto');
    const token = 'alte-sitzung-aus-version-1-6';
    const gen = crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
    const h = crypto.createHash('sha256').update(token).digest('hex');
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify({
      version: 1, sessions: [{ h, user: 'tony', gen, created: Date.now(), seen: Date.now(), remember: true }],
    }));

    const srv = await startServer({ dataDir });
    try {
      const cookie = `l3t_ipam=${token}`;
      const s = await req(srv.base, 'GET', '/api/auth/status', { cookie });
      assert.equal(s.json.authenticated, true, 'old session still valid');
      assert.equal(s.json.role, 'admin');
      const datei = JSON.parse(fs.readFileSync(path.join(dataDir, 'auth.json'), 'utf8'));
      assert.equal(datei.version, 2);
      assert.equal(datei.users[0].user, 'tony');
      assert.equal(datei.users[0].role, 'admin');
      assert.match(srv.logs, /auf mehrere Benutzer umgestellt/);
    } finally {
      await srv.stop();
    }
  });

  test('account from the Compose file is administrator and not editable', async () => {
    const srv = await startServer({ env: { IPAM_USER: 'root', IPAM_PASS: ADMIN_PASS } });
    try {
      const c = await login(srv.base, 'root', ADMIN_PASS);
      const r = await req(srv.base, 'GET', '/api/users', { cookie: c });
      assert.equal(r.json.users[0].source, 'umgebung');
      const id = r.json.users[0].id;
      const neu = await req(srv.base, 'POST', '/api/users', { cookie: c, body: { user: 'anna', role: 'admin', password: 'langes-passwort-1' } });
      assert.equal(neu.status, 201);
      const anna = await login(srv.base, 'anna', 'langes-passwort-1');
      assert.equal((await req(srv.base, 'DELETE', `/api/users/${id}`, { cookie: anna })).status, 409);
    } finally {
      await srv.stop();
    }
  });
});
