'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, req } = require('./helpers');

const PASS = 'korrekt-pferd-batterie';

describe('Ersteinrichtung und Anmeldung', () => {
  let srv;
  let cookie;
  before(async () => { srv = await startServer(); });
  after(() => srv.stop());

  test('Healthcheck ist ohne Anmeldung erreichbar', async () => {
    const r = await req(srv.base, 'GET', '/healthz');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  });

  test('ohne Sitzung: API gesperrt, Oberfläche leitet auf /login um', async () => {
    assert.equal((await req(srv.base, 'GET', '/api/state')).status, 401);
    assert.equal((await req(srv.base, 'GET', '/api/export')).status, 401);
    const root = await req(srv.base, 'GET', '/');
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), '/login');
    assert.equal((await req(srv.base, 'GET', '/app.js')).status, 302);
    assert.equal((await req(srv.base, 'GET', '/index.html')).status, 302);
  });

  test('Anmeldemaske und ihre Dateien sind öffentlich', async () => {
    for (const p of ['/login', '/login.js', '/style.css', '/logo.svg', '/icon.svg', '/fonts/plex-mono-400.woff2']) {
      assert.equal((await req(srv.base, 'GET', p)).status, 200, p);
    }
  });

  test('Sicherheits-Header sind gesetzt', async () => {
    const r = await req(srv.base, 'GET', '/login');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  });

  test('Status meldet Einrichtungsmodus, Code steht im Protokoll', async () => {
    const r = await req(srv.base, 'GET', '/api/auth/status');
    assert.equal(r.json.mode, 'setup');
    assert.equal(r.json.authenticated, false);
    assert.ok(srv.setupCode(), 'Einrichtungscode im Protokoll erwartet');
  });

  test('Einrichtung ohne Header wird abgelehnt (CSRF)', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/setup', {
      csrf: false, body: { code: srv.setupCode(), user: 'tony', password: PASS },
    });
    assert.equal(r.status, 403);
  });

  test('Einrichtung mit falschem Code scheitert', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/setup', { body: { code: 'AAAA-AAAA-AAAA', user: 'tony', password: PASS } });
    assert.equal(r.status, 401);
  });

  test('Einrichtung mit zu kurzem Passwort scheitert', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: 'kurz' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /mindestens 12/);
  });

  test('Passwort darf den Benutzernamen nicht enthalten', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: 'tony-tony-tony-1' } });
    assert.equal(r.status, 400);
  });

  test('Einrichtung klappt, Code kleingeschrieben und ohne Bindestriche', async () => {
    const code = srv.setupCode().replace(/-/g, '').toLowerCase();
    const r = await req(srv.base, 'POST', '/api/auth/setup', { body: { code, user: 'tony', password: PASS } });
    assert.equal(r.status, 201);
    assert.match(r.setCookie, /HttpOnly/);
    assert.match(r.setCookie, /SameSite=Strict/);
    assert.doesNotMatch(r.setCookie, /Secure/, 'ohne HTTPS kein Secure, sonst klappt der Zugriff im LAN nicht');
    cookie = r.cookie;
  });

  test('ein zweites Mal einrichten geht nicht', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'boese', password: PASS } });
    assert.equal(r.status, 409);
  });

  test('auth.json enthält nur den scrypt-Hash, kein Klartextpasswort', () => {
    const raw = fs.readFileSync(path.join(srv.dataDir, 'auth.json'), 'utf8');
    assert.ok(!raw.includes(PASS));
    const datei = JSON.parse(raw);
    assert.equal(datei.version, 2);
    assert.equal(datei.users[0].role, 'admin', 'das erste Konto ist Administrator');
    assert.match(datei.users[0].hash, /^scrypt\$32768\$8\$1\$/);
  });

  test('sessions.json enthält das Token nicht im Klartext', () => {
    const raw = fs.readFileSync(path.join(srv.dataDir, 'sessions.json'), 'utf8');
    assert.ok(!raw.includes(cookie.split('=')[1]));
  });

  test('mit Sitzung: Bestand lesbar, Oberfläche ausgeliefert, /login leitet zurück', async () => {
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie })).status, 200);
    assert.equal((await req(srv.base, 'GET', '/', { cookie })).status, 200);
    const l = await req(srv.base, 'GET', '/login', { cookie });
    assert.equal(l.status, 302);
    assert.equal(l.headers.get('location'), '/');
  });

  test('schreibende API-Aufrufe brauchen den Header', async () => {
    const ohne = await req(srv.base, 'PATCH', '/api/settings', { cookie, csrf: false, body: { theme: 'dark' } });
    assert.equal(ohne.status, 403);
    const mit = await req(srv.base, 'PATCH', '/api/settings', { cookie, body: { theme: 'dark' } });
    assert.equal(mit.status, 200);
  });

  test('gefälschtes oder fremdes Cookie wird abgewiesen', async () => {
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: 'l3t_ipam=erfunden' })).status, 401);
  });

  test('Anmeldung: falscher Name und falsches Passwort geben dieselbe Meldung', async () => {
    const a = await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: 'falsch-falsch-falsch' } });
    const b = await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'niemand', password: PASS } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.json.error, b.json.error);
  });

  test('Anmeldung mit «angemeldet bleiben» setzt ein dauerhaftes Cookie', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: PASS, remember: true } });
    assert.equal(r.status, 200);
    assert.match(r.setCookie, /Max-Age=2592000/);
  });

  test('Abmelden beendet die Sitzung serverseitig', async () => {
    const login = await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: PASS } });
    const c = login.cookie;
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: c })).status, 200);
    const out = await req(srv.base, 'POST', '/api/auth/logout', { cookie: c });
    assert.match(out.setCookie, /Max-Age=0/);
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: c })).status, 401);
  });

  test('Passwortwechsel: braucht das alte Passwort und meldet andere Geräte ab', async () => {
    const anderes = (await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: PASS } })).cookie;

    const falsch = await req(srv.base, 'POST', '/api/auth/password', { cookie, body: { current: 'nicht-das-richtige', next: 'neues-langes-passwort' } });
    assert.equal(falsch.status, 403);

    const ok = await req(srv.base, 'POST', '/api/auth/password', { cookie, body: { current: PASS, next: 'neues-langes-passwort' } });
    assert.equal(ok.status, 200);

    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie })).status, 200, 'eigene Sitzung bleibt');
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: anderes })).status, 401, 'andere Sitzung beendet');
    assert.equal((await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: PASS } })).status, 401);
    assert.equal((await req(srv.base, 'POST', '/api/auth/login', { body: { user: 'tony', password: 'neues-langes-passwort' } })).status, 200);
  });
});

describe('Sperre nach Fehlversuchen', () => {
  let srv;
  before(async () => {
    srv = await startServer({ env: { IPAM_USER: 'tony', IPAM_PASS: PASS, IPAM_TRUST_PROXY: '1' } });
  });
  after(() => srv.stop());

  test('nach 10 Fehlversuchen ist die Adresse gesperrt, auch für das richtige Passwort', async () => {
    const von = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 10; i++) {
      const r = await req(srv.base, 'POST', '/api/auth/login', { headers: von, body: { user: 'tony', password: `falsch-${i}-falsch-falsch` } });
      assert.equal(r.status, 401);
    }
    const r = await req(srv.base, 'POST', '/api/auth/login', { headers: von, body: { user: 'tony', password: PASS } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.match(srv.logs, /203\.0\.113\.7 nach 10 Fehlversuchen/);
  });

  test('eine andere Adresse ist davon nicht betroffen', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': '198.51.100.1' }, body: { user: 'tony', password: PASS } });
    assert.equal(r.status, 200);
  });

  test('hinter einem Proxy und mit HTTPS wird das Cookie als Secure markiert', async () => {
    const r = await req(srv.base, 'POST', '/api/auth/login', {
      headers: { 'CF-Connecting-IP': '198.51.100.2', 'X-Forwarded-Proto': 'https' },
      body: { user: 'tony', password: PASS },
    });
    assert.match(r.setCookie, /; Secure/);
  });

  test('Konto aus der Umgebung: Passwort lässt sich im UI nicht ändern', async () => {
    const { cookie } = await req(srv.base, 'POST', '/api/auth/login', { headers: { 'CF-Connecting-IP': '198.51.100.3' }, body: { user: 'tony', password: PASS } });
    const s = await req(srv.base, 'GET', '/api/auth/status', { cookie });
    assert.equal(s.json.managedByEnv, true);
    const r = await req(srv.base, 'POST', '/api/auth/password', { cookie, body: { current: PASS, next: 'neues-langes-passwort' } });
    assert.equal(r.status, 409);
  });
});

describe('Sitzungen über einen Neustart hinweg', () => {
  test('Sitzung bleibt nach Neustart gültig, nach Löschen von auth.json nicht mehr', async () => {
    let srv = await startServer();
    const { dataDir } = srv;
    const setup = await req(srv.base, 'POST', '/api/auth/setup', { body: { code: srv.setupCode(), user: 'tony', password: PASS, remember: true } });
    assert.equal(setup.status, 201);
    await srv.stop();

    srv = await startServer({ dataDir });
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: setup.cookie })).status, 200);
    assert.equal(srv.setupCode(), null, 'kein Einrichtungscode, wenn ein Konto existiert');
    await srv.stop();

    // «Passwort vergessen»: auth.json löschen und neu starten.
    fs.unlinkSync(path.join(dataDir, 'auth.json'));
    srv = await startServer({ dataDir });
    assert.equal((await req(srv.base, 'GET', '/api/state', { cookie: setup.cookie })).status, 401);
    assert.ok(srv.setupCode());
    await srv.stop();
  });
});

describe('Anmeldung abgeschaltet', () => {
  test('IPAM_AUTH=off öffnet die Oberfläche und warnt im Protokoll', async () => {
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      assert.equal((await req(srv.base, 'GET', '/api/state')).status, 200);
      assert.equal((await req(srv.base, 'GET', '/')).status, 200);
      assert.equal((await req(srv.base, 'GET', '/api/auth/status')).json.mode, 'off');
      assert.match(srv.logs, /IPAM_AUTH=off abgeschaltet/);
    } finally {
      await srv.stop();
    }
  });
});
