'use strict';

// Grundfunktionen der API, mit abgeschalteter Anmeldung.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req } = require('./helpers');

describe('API', () => {
  let srv;
  let vlan;
  before(async () => { srv = await startServer({ env: { IPAM_AUTH: 'off' } }); });
  after(() => srv.stop());

  test('Status liefert Version und leeren Bestand', async () => {
    const r = await req(srv.base, 'GET', '/api/state');
    assert.equal(r.status, 200);
    assert.match(r.json.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(r.json.vlans, []);
  });

  test('Netz anlegen, mit Sicherheitszone', async () => {
    const r = await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24', zone: ' Internal ' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.zone, 'Internal');
    vlan = r.json;
  });

  test('Zone bleibt beim Ändern anderer Felder erhalten', async () => {
    const r = await req(srv.base, 'PATCH', `/api/vlans/${vlan.id}`, { body: { name: 'Server neu' } });
    assert.equal(r.json.zone, 'Internal');
  });

  test('Host anlegen und doppelte Adresse ablehnen', async () => {
    const a = await req(srv.base, 'POST', '/api/hosts', { body: { vlanId: vlan.id, ip: '10.13.20.10', hostname: 'nas' } });
    assert.equal(a.status, 201);
    const b = await req(srv.base, 'POST', '/api/hosts', { body: { vlanId: vlan.id, ip: '10.13.20.10', hostname: 'zweit' } });
    assert.equal(b.status, 400);
    assert.match(b.json.error, /bereits vergeben/);
  });

  test('Export enthält den Bestand', async () => {
    const r = await req(srv.base, 'GET', '/api/export');
    assert.equal(r.status, 200);
    assert.equal(r.json.hosts.length, 1);
  });

  test('Pfade ausserhalb von public/ werden nicht ausgeliefert', async () => {
    for (const p of ['/../server.js', '/%2e%2e/server.js', '/..%2fauth.js']) {
      const r = await req(srv.base, 'GET', p);
      assert.notEqual(r.status, 200, p);
      assert.ok(!r.text.includes('createServer'), p);
    }
  });
});

describe('Auffälligkeiten ausblenden', () => {
  test('ausblenden, Sorten getrennt wieder einblenden, Unsinn ablehnen', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const ok = (key) => req(srv.base, 'POST', '/api/ignore', { body: { key, name: 'Sonos' } });
      assert.equal((await ok('auf:mac:abc-123|02:00:00:5a:0b:01')).status, 200);
      assert.equal((await ok('auf:pool:3f2a')).status, 200);
      assert.equal((await ok('chk:10.0.0.1|aa:bb:cc:dd:ee:ff')).status, 200);
      assert.equal((await ok('auf:erfunden:1')).status, 400);
      assert.equal((await ok('auf:mac:<script>')).status, 400);
      assert.equal((await req(srv.base, 'GET', '/api/state')).json.ignoriert.length, 3);

      const r = await req(srv.base, 'DELETE', '/api/ignore?art=auf');
      assert.equal(r.json.eingeblendet, 2);
      assert.deepEqual((await req(srv.base, 'GET', '/api/state')).json.ignoriert.map((i) => i.key), ['chk:10.0.0.1|aa:bb:cc:dd:ee:ff']);
      // Der alte Weg über /api/unifi/ignore funktioniert weiter
      assert.equal((await req(srv.base, 'POST', '/api/unifi/ignore', { body: { key: 'auf:name:1' } })).status, 200);
    } finally {
      await srv.stop();
    }
  });
});
