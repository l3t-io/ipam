'use strict';

// Feste Reservierungen sauber erkennen, Offline-Geräte finden und aufräumen.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeClient, offlineKandidaten, diff } = require('../app/unifi');
const { startServer, req } = require('./helpers');
const { startFakeUnifi } = require('./fake-unifi');

const TAG = 86400000;
const vorTagen = (n) => Math.floor((Date.now() - n * TAG) / 1000); // UniFi zählt in Sekunden

describe('Erkennung fester Reservierungen', () => {
  test('liegengebliebenes fixed_ip ohne Schalter ist keine Reservierung', () => {
    const c = normalizeClient({
      mac: 'BC-24-11-00-00-23', name: 'old-vm', use_fixedip: false, fixed_ip: '10.0.80.10', last_ip: '10.0.80.99', last_seen: vorTagen(90),
    });
    assert.equal(c.fixed, false);
    assert.equal(c.ip, '10.0.80.99', 'die zuletzt genutzte Adresse, nicht die alte feste');
    assert.equal(c.mac, 'bc:24:11:00:00:23');
    assert.ok(c.lastSeen > 0 && c.lastSeen < Date.now() - 89 * TAG);
  });

  test('mit Schalter ist es eine Reservierung auf die feste Adresse', () => {
    const c = normalizeClient({ mac: 'aa:bb:cc:00:00:01', use_fixedip: true, fixed_ip: '10.0.80.10', last_ip: '10.0.80.99' });
    assert.equal(c.fixed, true);
    assert.equal(c.ip, '10.0.80.10');
  });

  test('alte Einträge erscheinen im Abgleich nicht mehr als Reservierung', () => {
    const DMZ = { id: 'v', name: 'DMZ', vid: 80, cidr: '10.0.80.0/24', gateway: '10.0.80.1' };
    const clients = [
      normalizeClient({ mac: 'bc:24:11:00:00:23', name: 'old-vm', use_fixedip: false, fixed_ip: '10.0.80.10', last_seen: vorTagen(90) }),
      normalizeClient({ mac: '02:00:00:5a:0b:02', name: 'SonosZP', use_fixedip: false, fixed_ip: '10.0.80.15', last_seen: vorTagen(200) }),
    ];
    const d = diff({ vlans: [DMZ], hosts: [{ id: 'h', vlanId: 'v', ip: '10.0.80.10', hostname: 'PBX Server', mac: 'bc:24:11:aa:bb:cc', kind: 'statisch' }] }, {
      networks: [], devices: [], live: [], clients, reservations: clients.filter((c) => c.fixed && c.ip),
      controller: '', version: '', site: '', quellen: [], warnungen: [], at: '',
    });
    assert.deepEqual(d.hosts, []);
  });
});

describe('Offline-Kandidaten', () => {
  const NETZ = { id: 'v', name: 'IoT', vid: 30, cidr: '10.30.0.0/24' };
  const host = (n, kind, extra = {}) => ({ id: `h${n}`, vlanId: 'v', ip: `10.30.0.${n}`, hostname: `g${n}`, mac: `aa:bb:cc:00:00:${n}`, kind, ...extra });
  const unifi = (clients, live = [], devices = []) => ({ clients, live, devices });
  const bekannt = (n, tage) => ({ mac: `aa:bb:cc:00:00:${n}`, lastSeen: Date.now() - tage * TAG });

  test('nur DHCP-Einträge über der Frist, alles Unsichere bleibt', () => {
    const state = {
      vlans: [NETZ],
      settings: { offline: { tage: 30 } },
      hosts: [
        host(10, 'dhcp'),                          // 40 Tage weg → Kandidat
        host(11, 'dhcp'),                          // 5 Tage weg → zu frisch
        host(12, 'dhcp', { sporadisch: true }),    // sporadisch → nie
        host(13, 'statisch'),                      // statisch → ohne alleTypen nie
        host(14, 'dhcp'),                          // online
        host(15, 'dhcp'),                          // UniFi kennt die MAC nicht
        host(16, 'dhcp'),                          // UniFi-Gerät
        { ...host(17, 'dhcp'), mac: '' },          // ohne MAC
      ],
    };
    const r = offlineKandidaten(state, unifi(
      [bekannt(10, 40), bekannt(11, 5), bekannt(12, 400), bekannt(13, 400), bekannt(14, 400), bekannt(16, 400)],
      [{ mac: 'aa:bb:cc:00:00:14', ip: '10.30.0.14' }],
      [{ mac: 'aa:bb:cc:00:00:16', ip: '10.30.0.16' }],
    ));
    assert.deepEqual(r.kandidaten.map((k) => k.ip), ['10.30.0.10']);
    assert.equal(r.kandidaten[0].tage, 40);
    assert.equal(r.ohneDaten, 1);
  });

  test('mit alleTypen auch statische und reservierte', () => {
    const state = { vlans: [NETZ], settings: { offline: { tage: 30, alleTypen: true } }, hosts: [host(13, 'statisch'), host(18, 'reserviert')] };
    const r = offlineKandidaten(state, unifi([bekannt(13, 60), bekannt(18, 31)]));
    assert.deepEqual(r.kandidaten.map((k) => k.ip), ['10.30.0.13', '10.30.0.18']);
  });
});

describe('Aufräumen über die Schnittstelle', () => {
  // Bekannte Clients im Controller: alle seit 40 Tagen weg, keiner fest reserviert.
  const known = [10, 11, 12, 13, 14, 15].map((n) => ({
    mac: `aa:bb:cc:00:01:${n}`, name: `g${n}`, use_fixedip: false, fixed_ip: `10.13.20.${n}`, last_seen: vorTagen(40),
  }));

  async function aufbau(hosts) {
    const ctl = await startFakeUnifi({ reservations: known });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    const v = (await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24' } })).json;
    for (const [n, kind, extra] of hosts) {
      await req(srv.base, 'POST', '/api/hosts', { body: { vlanId: v.id, ip: `10.13.20.${n}`, hostname: `g${n}`, mac: `aa:bb:cc:00:01:${n}`, kind, ...extra } });
    }
    await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
    return { ctl, srv };
  }
  const ips = async (srv) => (await req(srv.base, 'GET', '/api/state')).json.hosts.map((h) => h.ip).sort();

  test('Abgleich: keine falschen Reservierungen, Offline-Gruppe, Entfernen per Auswahl', async () => {
    const { ctl, srv } = await aufbau([[10, 'dhcp'], [11, 'dhcp', { sporadisch: true }], [12, 'statisch']]);
    try {
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.deepEqual(d.json.hosts, [], 'liegengebliebene fixed_ip sind keine Reservierungen');
      assert.deepEqual(d.json.offline.kandidaten.map((k) => k.ip), ['10.13.20.10']);
      const a = await req(srv.base, 'POST', '/api/unifi/apply', { body: { keys: ['off:' + d.json.offline.kandidaten[0].id] } });
      assert.equal(a.status, 200, a.text);
      assert.match(a.json.angewendet[0], /entfernt \(seit 40 Tagen offline\)/);
      assert.deepEqual(await ips(srv), ['10.13.20.11', '10.13.20.12']);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Einstellung speichern und von Hand aufräumen', async () => {
    const { ctl, srv } = await aufbau([[10, 'dhcp'], [11, 'dhcp'], [12, 'statisch'], [13, 'dhcp', { sporadisch: true }],
      [14, 'statisch'], [15, 'statisch']]);
    try {
      assert.equal((await req(srv.base, 'PUT', '/api/unifi/offline', { body: { auto: true, tage: 0 } })).status, 400);
      const e = await req(srv.base, 'PUT', '/api/unifi/offline', { body: { auto: true, tage: 30, alleTypen: false } });
      assert.deepEqual(e.json, { auto: true, tage: 30, alleTypen: false });
      const vorschau = await req(srv.base, 'GET', '/api/unifi/offline');
      assert.equal(vorschau.json.kandidaten.length, 2);

      const r = await req(srv.base, 'POST', '/api/unifi/offline/run');
      assert.deepEqual(r.json.entfernt.map((x) => x.ip), ['10.13.20.10', '10.13.20.11']);
      assert.deepEqual(await ips(srv), ['10.13.20.12', '10.13.20.13', '10.13.20.14', '10.13.20.15']);
      assert.match(srv.logs, /Offline-Aufräumen: 10\.13\.20\.10 g10/);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Schutz: zu viele auf einmal → nichts wird entfernt', async () => {
    const { ctl, srv } = await aufbau([[10, 'dhcp'], [11, 'dhcp'], [12, 'dhcp'], [13, 'dhcp'], [14, 'dhcp']]);
    try {
      const r = await req(srv.base, 'POST', '/api/unifi/offline/run');
      assert.deepEqual(r.json.entfernt, []);
      assert.match(r.json.grund, /zu viele auf einmal/);
      assert.equal((await ips(srv)).length, 5);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('«sporadisch» bleibt beim Bearbeiten anderer Felder erhalten und lässt sich ausschalten', async () => {
    const { ctl, srv } = await aufbau([[13, 'dhcp', { sporadisch: true }]]);
    try {
      const h = (await req(srv.base, 'GET', '/api/state')).json.hosts[0];
      assert.equal((await req(srv.base, 'PATCH', `/api/hosts/${h.id}`, { body: { notes: 'Akku' } })).json.sporadisch, true);
      assert.equal((await req(srv.base, 'PATCH', `/api/hosts/${h.id}`, { body: { sporadisch: false } })).json.sporadisch, false);
    } finally { await srv.stop(); await ctl.stop(); }
  });
});

describe('Rechte rund um die Einstellungen', () => {
  test('über das Erscheinungsbild lassen sich keine anderen Einstellungen schreiben', async () => {
    const srv = await startServer();
    try {
      const admin = (await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: 'korrekt-pferd-batterie' } })).cookie;
      await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'gast', role: 'leser', password: 'langes-passwort-2' } });
      const gast = (await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'gast', password: 'langes-passwort-2' } })).cookie;

      const r = await req(srv.base, 'PATCH', '/api/settings', { cookie: gast, body: { theme: 'dark', offline: { auto: true, tage: 1, alleTypen: true } } });
      assert.equal(r.status, 200);
      const s = (await req(srv.base, 'GET', '/api/state', { cookie: admin })).json.settings;
      assert.equal(s.theme, 'dark');
      assert.equal(s.offline.auto, false, 'Offline-Einstellung unverändert');
      assert.equal((await req(srv.base, 'PUT', '/api/unifi/offline', { cookie: gast, body: { auto: true, tage: 1 } })).status, 403);
      assert.equal((await req(srv.base, 'POST', '/api/unifi/offline/run', { cookie: gast })).status, 403);
    } finally {
      await srv.stop();
    }
  });
});
