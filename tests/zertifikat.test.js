'use strict';

// Zertifikat des Controllers merken und prüfen (trust on first use).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { startServer, req } = require('./helpers');
const { startFakeUnifi } = require('./fake-unifi');

const fixture = (n) => ({
  key: fs.readFileSync(path.join(__dirname, 'fixtures', `controller-${n}.key`)),
  cert: fs.readFileSync(path.join(__dirname, 'fixtures', `controller-${n}.crt`)),
});
const A = fixture('a');
const B = fixture('b');
const fp = (f) => new X509Certificate(f.cert).fingerprint256;

const freierPort = () => new Promise((ok) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

describe('Zertifikat des Controllers', () => {
  test('wird beim Speichern gemerkt; ein anderes Zertifikat bricht ab, bevor der Schlüssel gesendet wird', async () => {
    const ctl = await startFakeUnifi({ tls: A });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const t = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      assert.equal(t.json.ok, true, t.json.error);
      assert.equal(t.json.zertifikat, fp(A), 'Test zeigt den Fingerabdruck');

      const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      assert.equal(s.json.zertifikat, fp(A));
      assert.equal((await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).status, 200);

      // Jemand schaltet sich mit einem anderen Zertifikat dazwischen
      ctl.zertifikatTauschen(B);
      const vorher = ctl.seenKeys.length;
      await new Promise((r) => setTimeout(r, 5100)); // «Neu abfragen» ist auf alle 5 s begrenzt
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.equal(d.status, 400);
      assert.match(d.json.error, /Zertifikat des Controllers hat sich geändert/);
      assert.equal(ctl.seenKeys.length, vorher, 'keine einzige Anfrage mit Schlüssel erreichte den Server');

      // Bewusst bestätigen: erneut speichern (Schlüssel leer lassen)
      const neu = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: '', site: 'default' } });
      assert.equal(neu.json.zertifikat, fp(B));
      assert.equal((await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).status, 200);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('Fingerabdruck übersteht einen Neustart und steht nicht in der Antwort von /api/state', async () => {
    const ctl = await startFakeUnifi({ tls: A });
    let srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      const { dataDir } = srv;
      await srv.stop();
      srv = await startServer({ dataDir, env: { IPAM_AUTH: 'off' } });
      assert.equal((await req(srv.base, 'GET', '/api/unifi/config')).json.zertifikat, fp(A));
      ctl.zertifikatTauschen(B);
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.match(d.json.error || '', /Zertifikat des Controllers hat sich geändert/);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('war der Controller beim Speichern nicht erreichbar, wird bei der ersten Verbindung gemerkt', async () => {
    const port = await freierPort();
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    let ctl;
    try {
      const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: `https://127.0.0.1:${port}`, key: 'richtiger-schluessel-1234', site: 'default' } });
      assert.equal(s.json.zertifikat, '');
      ctl = await startFakeUnifi({ tls: A, port });
      assert.equal((await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).status, 200);
      assert.equal((await req(srv.base, 'GET', '/api/unifi/config')).json.zertifikat, fp(A));
    } finally { await srv.stop(); if (ctl) await ctl.stop(); }
  });

  test('mit «Zertifikat prüfen» (CA) wird nichts gemerkt', async () => {
    const ctl = await startFakeUnifi({ tls: A });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default', insecure: false } });
      assert.equal(s.json.zertifikat, '');
    } finally { await srv.stop(); await ctl.stop(); }
  });
});
