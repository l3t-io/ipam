'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, req } = require('./helpers');
const { startFakeUnifi } = require('./fake-unifi');

describe('UniFi-Anbindung in der Oberfläche', () => {
  let srv;
  let ctl;
  before(async () => {
    ctl = await startFakeUnifi();
    srv = await startServer({ env: { IPAM_AUTH: 'off' } });
  });
  after(async () => { await srv.stop(); await ctl.stop(); });

  test('ohne Einrichtung: nicht konfiguriert', async () => {
    const r = await req(srv.base, 'GET', '/api/unifi/config');
    assert.equal(r.json.source, 'keine');
    assert.equal(r.json.configured, false);
    assert.equal((await req(srv.base, 'GET', '/api/state')).json.unifi, false);
  });

  test('ungültige Eingaben werden abgelehnt', async () => {
    const faelle = [
      [{ url: 'kein-url', key: 'x' }, /gültige URL/],
      [{ url: 'ftp://10.1.1.1', key: 'x' }, /https:\/\//],
      [{ url: 'https://admin:pw@10.1.1.1', key: 'x' }, /Zugangsdaten/],
      [{ url: 'https://10.1.1.1/proxy/network', key: 'x' }, /ohne Pfad/],
      [{ url: 'https://10.1.1.1' }, /Schlüssel fehlt/],
      [{ url: 'https://10.1.1.1', key: 'x', site: 'a/b' }, /Site/],
    ];
    for (const [body, fehler] of faelle) {
      const r = await req(srv.base, 'PUT', '/api/unifi/config', { body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.json.error, fehler);
    }
  });

  test('Verbindung testen: falscher Schlüssel wird gemeldet, nichts gespeichert', async () => {
    const r = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: ctl.url, key: 'falscher-schluessel', site: 'default' } });
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /abgelehnt/);
    assert.equal((await req(srv.base, 'GET', '/api/unifi/config')).json.source, 'keine');
  });

  test('Verbindung testen: richtiger Schlüssel liefert eine Zusammenfassung', async () => {
    const r = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
    assert.equal(r.json.ok, true, r.json.error);
    assert.equal(r.json.version, '9.4.19');
    assert.equal(r.json.netze, 1);
    assert.equal(r.json.geraete, 1);
    assert.equal(r.json.live, 1);
  });

  test('Speichern: Schlüssel landet in unifi.json, nie in der Antwort', async () => {
    const r = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: `${ctl.url}/`, key: ctl.key, site: 'default' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'web');
    assert.equal(r.json.url, ctl.url, 'Schrägstrich am Ende entfernt');
    assert.equal(r.json.hasKey, true);
    assert.equal(r.json.keyHint, '…1234');
    assert.ok(!r.text.includes(ctl.key));

    const datei = JSON.parse(fs.readFileSync(path.join(srv.dataDir, 'unifi.json'), 'utf8'));
    assert.equal(datei.key, ctl.key);
  });

  test('nach dem Speichern: UniFi aktiv, Abgleich läuft', async () => {
    assert.equal((await req(srv.base, 'GET', '/api/state')).json.unifi, true);
    const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.netze.filter((n) => n.art === 'neu').length, 1);
  });

  test('Schlüssel steht weder im Bestand noch im Export', async () => {
    const exp = await req(srv.base, 'GET', '/api/export');
    assert.ok(!exp.text.includes(ctl.key));
    assert.ok(!(await req(srv.base, 'GET', '/api/state')).text.includes(ctl.key));
    assert.ok(!fs.readFileSync(path.join(srv.dataDir, 'ipam.json'), 'utf8').includes(ctl.key));
  });

  test('Schlüssel leer lassen behält den gespeicherten', async () => {
    const r = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: '', site: 'default', insecure: false } });
    assert.equal(r.status, 200);
    assert.equal(r.json.insecure, false);
    const t = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: ctl.url, site: 'default' } });
    assert.equal(t.json.ok, true, t.json.error);
  });

  test('geänderte Adresse ohne neuen Schlüssel: der alte wird nicht dorthin geschickt', async () => {
    const vorher = ctl.seenKeys.length;
    const fremd = 'http://127.0.0.1:1';
    const t = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: fremd, site: 'default' } });
    assert.equal(t.status, 400);
    assert.match(t.json.error, /Schlüssel neu eingeben/);
    const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: fremd, site: 'default' } });
    assert.equal(s.status, 400);
    assert.equal(ctl.seenKeys.length, vorher);
  });

  test('gespeicherte Einstellung übersteht einen Neustart', async () => {
    const { dataDir } = srv;
    await srv.stop();
    srv = await startServer({ dataDir, env: { IPAM_AUTH: 'off' } });
    const r = await req(srv.base, 'GET', '/api/unifi/config');
    assert.equal(r.json.source, 'web');
    assert.equal(r.json.url, ctl.url);
    assert.match(srv.logs, /UniFi-Anbindung aktiv \(aus der Oberfläche\)/);
  });

  test('Entfernen löscht unifi.json', async () => {
    const r = await req(srv.base, 'DELETE', '/api/unifi/config');
    assert.equal(r.json.source, 'keine');
    assert.ok(!fs.existsSync(path.join(srv.dataDir, 'unifi.json')));
    assert.equal((await req(srv.base, 'GET', '/api/state')).json.unifi, false);
  });

  test('ohne Header kein Speichern (CSRF)', async () => {
    const r = await req(srv.base, 'PUT', '/api/unifi/config', { csrf: false, body: { url: ctl.url, key: ctl.key } });
    assert.equal(r.status, 403);
  });
});

describe('UniFi aus der Compose-Datei', () => {
  test('Umgebung gilt als Rückfall, die Oberfläche hat Vorrang', async () => {
    const srv = await startServer({
      env: { IPAM_AUTH: 'off', IPAM_UNIFI_URL: 'https://10.9.9.9', IPAM_UNIFI_KEY: 'aus-der-umgebung-abcd' },
    });
    try {
      let r = await req(srv.base, 'GET', '/api/unifi/config');
      assert.equal(r.json.source, 'umgebung');
      assert.equal(r.json.url, 'https://10.9.9.9');
      assert.equal(r.json.keyHint, '…abcd');

      r = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: 'https://10.1.1.1', key: 'neu-in-der-oberflaeche', site: 'default' } });
      assert.equal(r.json.source, 'web');
      assert.equal(r.json.url, 'https://10.1.1.1');

      r = await req(srv.base, 'DELETE', '/api/unifi/config');
      assert.equal(r.json.source, 'umgebung', 'nach dem Entfernen gilt wieder die Compose-Datei');
    } finally {
      await srv.stop();
    }
  });
});

describe('UniFi-Einstellungen mit Anmeldung', () => {
  test('ohne Sitzung nicht lesbar', async () => {
    const srv = await startServer();
    try {
      assert.equal((await req(srv.base, 'GET', '/api/unifi/config')).status, 401);
      assert.equal((await req(srv.base, 'POST', '/api/unifi/test', { body: { url: 'https://10.1.1.1', key: 'x' } })).status, 401);
    } finally {
      await srv.stop();
    }
  });
});

describe('Übernahme bei veralteter Reservierung', () => {
  test('übernimmt das Gerät, das tatsächlich online ist', async () => {
    // Im Controller ist .50 noch für «alt» reserviert, online ist aber «laptop» mit anderer MAC.
    const ctl = await startFakeUnifi({
      reservations: [{ name: 'alt', mac: 'aa:bb:cc:00:00:99', fixed_ip: '10.13.20.50', use_fixedip: true }],
    });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24' } });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      const h = d.json.hosts.find((x) => x.unifi.ip === '10.13.20.50');
      assert.equal(h.unifi.name, 'laptop');
      assert.equal(h.veraltet.name, 'alt');

      const a = await req(srv.base, 'POST', '/api/unifi/apply', { body: { keys: [h.key] } });
      assert.equal(a.status, 200, a.text);
      const host = (await req(srv.base, 'GET', '/api/state')).json.hosts.find((x) => x.ip === '10.13.20.50');
      assert.equal(host.hostname, 'laptop');
      assert.equal(host.mac, 'aa:bb:cc:00:00:50');
    } finally {
      await srv.stop();
      await ctl.stop();
    }
  });
});

describe('Sicherheitszonen aus UniFi', () => {
  const abgleich = async (zonen) => {
    const ctl = await startFakeUnifi({ zonen });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
    const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
    return { ctl, srv, d };
  };

  test('Integration API: Zone wird mitgelesen und beim Übernehmen gespeichert', async () => {
    const { ctl, srv, d } = await abgleich('integration');
    try {
      const n = d.json.netze.find((x) => x.art === 'neu');
      assert.equal(n.unifi.zone, 'Internal');
      assert.ok(d.json.meta.quellen.includes('Zonen über Integration API'));
      await req(srv.base, 'POST', '/api/unifi/apply', { body: { keys: [n.key] } });
      const vlan = (await req(srv.base, 'GET', '/api/state')).json.vlans[0];
      assert.equal(vlan.zone, 'Internal');
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('ältere API mit eigenen Netz-IDs: Zuordnung über das Subnetz', async () => {
    const { ctl, srv, d } = await abgleich('klassisch');
    try {
      assert.equal(d.json.netze.find((x) => x.art === 'neu').unifi.zone, 'DMZ');
      assert.ok(d.json.meta.quellen.includes('Zonen über klassische API'));
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Netze über die ältere API, Zonen über die neue: Zuordnung über die VLAN-ID', async () => {
    const ctl = await startFakeUnifi({ zonen: 'integration', netzeOhneSubnetz: true });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.ok(d.json.meta.quellen.includes('Netze über klassische API'));
      assert.equal(d.json.netze.find((x) => x.art === 'neu').unifi.zone, 'Internal');
      assert.match(d.json.meta.zonenInfo, /2 Zonen gelesen, 1 von 1 Netzen zugeordnet/);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Diagnose, wenn keine Zonen kommen', async () => {
    const ctl = await startFakeUnifi({ zonen: 'keine' });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.match(d.json.meta.zonenInfo, /Keine Sicherheitszonen gelesen/);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('ohne Zonen im Controller bleibt das Feld leer, ohne Fehler', async () => {
    const { ctl, srv, d } = await abgleich('keine');
    try {
      assert.equal(d.status, 200);
      assert.equal(d.json.netze.find((x) => x.art === 'neu').unifi.zone, '');
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Zone wird automatisch gespiegelt, ohne Auswahl und Übernehmen', async () => {
    const ctl = await startFakeUnifi();
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const server = (await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24', gateway: '10.13.20.1', zone: 'DMZ' } })).json;
      const lab = (await req(srv.base, 'POST', '/api/vlans', { body: { vid: 99, name: 'Lab', cidr: '10.99.0.0/24', zone: 'Labor' } })).json;
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });

      // Schon das normale Laden der Seite (Live-Daten) genügt.
      await req(srv.base, 'GET', '/api/unifi/live');
      let vlans = (await req(srv.base, 'GET', '/api/state')).json.vlans;
      const s1 = vlans.find((v) => v.id === server.id);
      assert.equal(s1.zone, 'Internal');
      assert.equal(s1.zoneAusUnifi, true);
      assert.match(srv.logs, /Zonen aus UniFi übernommen: .*10\.13\.20\.0\/24: DMZ → Internal/);
      assert.match(srv.logs, /Zone «Internal» angelegt/);

      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.ok(!d.json.netze.some((n) => n.art === 'abweichend'), 'nichts mehr zu übernehmen');

      // Von Hand lässt sich eine Zone aus UniFi nicht überschreiben …
      const p = await req(srv.base, 'PATCH', `/api/vlans/${server.id}`, { body: { zone: 'DMZ', name: 'Server neu' } });
      assert.equal(p.json.zone, 'Internal');
      assert.equal(p.json.name, 'Server neu');
      // … bei einem Netz, das UniFi nicht kennt, schon.
      vlans = (await req(srv.base, 'GET', '/api/state')).json.vlans;
      assert.equal(vlans.find((v) => v.id === lab.id).zoneAusUnifi, false);
      assert.equal((await req(srv.base, 'PATCH', `/api/vlans/${lab.id}`, { body: { zone: 'Werkstatt' } })).json.zone, 'Werkstatt');
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('liefert der Controller keine Zonen, bleiben die eigenen unangetastet', async () => {
    const ctl = await startFakeUnifi({ zonen: 'keine' });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24', zone: 'DMZ' } });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      const v = (await req(srv.base, 'GET', '/api/state')).json.vlans[0];
      assert.equal(v.zone, 'DMZ');
      assert.ok(!v.zoneAusUnifi);
    } finally { await srv.stop(); await ctl.stop(); }
  });
});

describe('Hinweise «In UniFi prüfen» ausblenden', () => {
  test('ausblenden, bleibt nach Neustart weg, kommt bei geänderter Reservierung zurück', async () => {
    const alt = { name: 'SonosZP', mac: '02:00:00:5a:0b:02', fixed_ip: '10.13.20.50', use_fixedip: true, last_seen: Math.floor(Date.now() / 1000) - 200 * 86400 };
    let ctl = await startFakeUnifi({ reservations: [alt] });
    let srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    const { dataDir } = srv;
    try {
      const v = (await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24' } })).json;
      await req(srv.base, 'POST', '/api/hosts', { body: { vlanId: v.id, ip: '10.13.20.50', hostname: 'Sonos Era', mac: 'aa:bb:cc:00:00:50' } });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });

      let d = (await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).json;
      assert.equal(d.pruefen.length, 1);
      assert.equal((await req(srv.base, 'POST', '/api/unifi/ignore', { body: { key: 'chk:kaputt' } })).status, 400);
      assert.equal((await req(srv.base, 'POST', '/api/unifi/ignore', { body: { key: d.pruefen[0].key, name: 'SonosZP' } })).status, 200);

      d = (await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).json;
      assert.equal(d.pruefen.length, 0);
      assert.equal(d.ausgeblendet, 1);

      await srv.stop();
      srv = await startServer({ dataDir, env: { IPAM_AUTH: 'off' } });
      d = (await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).json;
      assert.equal(d.pruefen.length, 0, 'bleibt nach Neustart ausgeblendet');

      // Reservierung zeigt jetzt auf ein anderes altes Gerät → neuer Hinweis
      await ctl.stop();
      ctl = await startFakeUnifi({ reservations: [{ ...alt, mac: '02:00:00:5a:0b:99' }] });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      d = (await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).json;
      assert.equal(d.pruefen.length, 1);

      assert.equal((await req(srv.base, 'DELETE', '/api/unifi/ignore')).json.eingeblendet, 1);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('«Lesen» darf nichts ausblenden', async () => {
    const srv = await startServer();
    try {
      const admin = (await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: 'korrekt-pferd-batterie' } })).cookie;
      await req(srv.base, 'POST', '/api/users', { cookie: admin, body: { user: 'gast', role: 'leser', password: 'langes-passwort-2' } });
      const gast = (await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'gast', password: 'langes-passwort-2' } })).cookie;
      const r = await req(srv.base, 'POST', '/api/unifi/ignore', { cookie: gast, body: { key: 'chk:10.0.0.1|aa:bb:cc:dd:ee:ff' } });
      assert.equal(r.status, 403);
    } finally { await srv.stop(); }
  });
});

describe('Typ aus Reservierungen', () => {
  test('neue Reservierung wird als «reserviert» angelegt, bestehende lässt sich korrigieren', async () => {
    const drucker = { name: 'drucker', mac: 'aa:bb:cc:00:00:21', fixed_ip: '10.13.20.21', use_fixedip: true, last_seen: Math.floor(Date.now() / 1000) };
    const nas = { name: 'nas', mac: 'aa:bb:cc:00:00:22', fixed_ip: '10.13.20.22', use_fixedip: true, last_seen: Math.floor(Date.now() / 1000) };
    const ctl = await startFakeUnifi({ reservations: [drucker, nas] });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const v = (await req(srv.base, 'POST', '/api/vlans', { body: { vid: 20, name: 'Server', cidr: '10.13.20.0/24' } })).json;
      await req(srv.base, 'POST', '/api/hosts', { body: { vlanId: v.id, ip: '10.13.20.22', hostname: 'nas', mac: nas.mac, kind: 'statisch' } });
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      const d = (await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).json;
      const keys = d.hosts.map((h) => h.key);
      assert.equal(keys.length, 2);
      await req(srv.base, 'POST', '/api/unifi/apply', { body: { keys } });
      const hosts = (await req(srv.base, 'GET', '/api/state')).json.hosts;
      assert.deepEqual(hosts.map((h) => [h.ip, h.kind]).sort(), [['10.13.20.21', 'reserviert'], ['10.13.20.22', 'reserviert']]);
    } finally { await srv.stop(); await ctl.stop(); }
  });
});
