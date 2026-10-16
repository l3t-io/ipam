'use strict';

// Zone management: records, colours, UniFi as source, migration of older data.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, req, tempDir } = require('./helpers');
const { startFakeUnifi } = require('./fake-unifi');

const state = async (srv, cookie) => (await req(srv.base, 'GET', '/api/state', { cookie })).json;
const zoneNamed = (s, name) => s.zones.find((z) => z.name === name);

describe('Zones as records', () => {
  test('data from before 2.1: zone names on networks become zones with preset colours', async () => {
    const dataDir = tempDir();
    fs.writeFileSync(path.join(dataDir, 'ipam.json'), JSON.stringify({
      version: 1, settings: {}, hosts: [],
      vlans: [
        { id: 'a', name: 'Server', cidr: '10.20.0.0/24', zone: 'Server', zoneAusUnifi: true },
        { id: 'b', name: 'DMZ', cidr: '10.80.0.0/24', zone: 'dmz' },
        { id: 'c', name: 'Lab', cidr: '10.90.0.0/24', zone: 'Lab' },
        { id: 'd', name: 'Lab 2', cidr: '10.91.0.0/24', zone: 'LAB' },
      ],
    }));
    const srv = await startServer({ dataDir, env: { IPAM_AUTH: 'off' } });
    try {
      const s = await state(srv);
      assert.deepEqual(s.zones.map((z) => [z.name, z.color, z.quelle]).sort(), [
        ['Lab', 'bernstein', 'manuell'], ['Server', 'rosa', 'unifi'], ['dmz', 'rot', 'manuell'],
      ].sort(), 'Lab gets the first colour not taken by a preset at that moment');
      assert.equal(s.vlans.find((v) => v.id === 'd').zone, 'Lab', 'spelling follows the zone');
      assert.match(srv.logs, /Zonen eingerichtet: 3/);
    } finally { await srv.stop(); }
  });

  test('create, rename (networks follow), recolour, delete (networks lose their zone)', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const z = (await req(srv.base, 'POST', '/api/zones', { body: { name: 'Lab', color: 'blau', beschreibung: 'Tests' } })).json;
      assert.equal(z.quelle, 'manuell');
      assert.equal((await req(srv.base, 'POST', '/api/zones', { body: { name: 'lab', color: 'rot' } })).status, 400, 'names are unique, any case');
      assert.equal((await req(srv.base, 'POST', '/api/zones', { body: { name: 'X', color: 'red; x' } })).status, 400);
      assert.equal((await req(srv.base, 'POST', '/api/zones', { body: { name: 'Y', color: '#12ab9F' } })).json.color, '#12AB9F');

      const v = (await req(srv.base, 'POST', '/api/vlans', { body: { name: 'Bench', cidr: '10.5.0.0/24', zone: 'lab' } })).json;
      assert.equal(v.zone, 'Lab', 'existing zone, its spelling');

      const r = await req(srv.base, 'PATCH', `/api/zones/${z.id}`, { body: { name: 'Workshop', color: 'violett' } });
      assert.equal(r.json.name, 'Workshop');
      assert.equal((await state(srv)).vlans.find((x) => x.id === v.id).zone, 'Workshop');

      const d = await req(srv.base, 'DELETE', `/api/zones/${z.id}`);
      assert.equal(d.json.netzeOhneZone, 1);
      const s = await state(srv);
      assert.equal(zoneNamed(s, 'Workshop'), undefined);
      assert.equal(s.vlans.find((x) => x.id === v.id).zone, '');
    } finally { await srv.stop(); }
  });

  test('a new zone name on a network creates the zone, with a preset colour if known', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'POST', '/api/vlans', { body: { name: 'Guests', cidr: '10.50.0.0/24', zone: 'Hotspot' } });
      const z = zoneNamed(await state(srv), 'Hotspot');
      assert.equal(z.color, 'bernstein');
      assert.equal(z.quelle, 'manuell');
    } finally { await srv.stop(); }
  });

  test('import carries zones along', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const r = await req(srv.base, 'POST', '/api/import', { body: {
        zones: [{ id: 'z1', name: 'Lab', color: '#336699', beschreibung: 'imported', quelle: 'manuell' }, { name: '', color: 'rot' }],
        vlans: [{ id: 'n1', name: 'Bench', cidr: '10.5.0.0/24', zone: 'Lab' }], hosts: [],
      } });
      assert.equal(r.status, 200, r.text);
      const s = await state(srv);
      assert.deepEqual(s.zones.map((z) => [z.name, z.color, z.beschreibung]), [['Lab', '#336699', 'imported']]);
    } finally { await srv.stop(); }
  });
});

describe('Zones from UniFi', () => {
  test('controller zones are created automatically; system zones only if used', async () => {
    const ctl = await startFakeUnifi();
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'POST', '/api/zones', { body: { name: 'Internal', color: 'blau' } });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      await req(srv.base, 'GET', '/api/unifi/live');
      const s = await state(srv);
      const internal = zoneNamed(s, 'Internal');
      assert.equal(internal.quelle, 'unifi', 'a manual zone of the same name now comes from UniFi');
      assert.equal(internal.color, 'blau', 'its colour is kept');
      assert.equal(zoneNamed(s, 'External'), undefined, 'system zone without networks is not created');

      // UniFi zones: name fixed, colour and description editable, not deletable
      const r = await req(srv.base, 'PATCH', `/api/zones/${internal.id}`, { body: { name: 'Renamed', color: 'gruen', beschreibung: 'LAN' } });
      assert.equal(r.json.name, 'Internal');
      assert.equal(r.json.color, 'gruen');
      assert.equal((await req(srv.base, 'DELETE', `/api/zones/${internal.id}`)).status, 409);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('a zone that disappears from the controller becomes a manual zone', async () => {
    let ctl = await startFakeUnifi();
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      await req(srv.base, 'GET', '/api/unifi/live');
      assert.equal(zoneNamed(await state(srv), 'Internal').quelle, 'unifi');
      await ctl.stop();
      ctl = await startFakeUnifi({ zonen: 'klassisch' }); // now only «DMZ» exists
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      await req(srv.base, 'GET', '/api/unifi/live');
      const s = await state(srv);
      assert.equal(zoneNamed(s, 'Internal').quelle, 'manuell');
      assert.equal(zoneNamed(s, 'DMZ').quelle, 'unifi');
    } finally { await srv.stop(); await ctl.stop(); }
  });
});

describe('Zone permissions', () => {
  test('viewers can see zones but not change them', async () => {
    const srv = await startServer();
    try {
      const admin = (await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: 'korrekt-pferd-batterie' } })).cookie;
      await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'gast', role: 'leser', password: 'langes-passwort-2' } });
      await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'anna', role: 'bearbeiter', password: 'langes-passwort-1' } });
      const login = async (user, password) => (await req(srv.base, 'POST', '/api/auth/login', { body: { user, password } })).cookie;
      const gast = await login('gast', 'langes-passwort-2');
      const anna = await login('anna', 'langes-passwort-1');
      assert.equal((await req(srv.base, 'POST', '/api/zones', { cookie: gast, body: { name: 'Lab', color: 'rot' } })).status, 403);
      assert.equal((await req(srv.base, 'POST', '/api/zones', { cookie: anna, body: { name: 'Lab', color: 'rot' } })).status, 201);
      assert.equal((await state(srv, gast)).zones.length, 1);
    } finally { await srv.stop(); }
  });
});
