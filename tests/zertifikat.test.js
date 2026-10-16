'use strict';

// Remember and verify the controller's certificate (trust on first use).

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

describe('Controller certificate', () => {
  test('is remembered on save; a different certificate aborts before the key is sent', async () => {
    const ctl = await startFakeUnifi({ tls: A });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const t = await req(srv.base, 'POST', '/api/unifi/test', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      assert.equal(t.json.ok, true, t.json.error);
      assert.equal(t.json.zertifikat, fp(A), 'test shows the fingerprint');

      const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default' } });
      assert.equal(s.json.zertifikat, fp(A));
      assert.equal((await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).status, 200);

      // Someone steps in between with a different certificate
      ctl.zertifikatTauschen(B);
      const vorher = ctl.seenKeys.length;
      await new Promise((r) => setTimeout(r, 5100)); // «Refresh» is limited to once every 5 s
      const d = await req(srv.base, 'GET', '/api/unifi/diff?refresh=1');
      assert.equal(d.status, 400);
      assert.match(d.json.error, /Zertifikat des Controllers hat sich geändert/);
      assert.equal(ctl.seenKeys.length, vorher, 'not a single request with the key reached the server');

      // Confirm deliberately: save again (leave the key empty)
      const neu = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: '', site: 'default' } });
      assert.equal(neu.json.zertifikat, fp(B));
      assert.equal((await req(srv.base, 'GET', '/api/unifi/diff?refresh=1')).status, 200);
    } finally { await srv.stop(); await ctl.stop(); }
  });

  test('fingerprint survives a restart and is not in the /api/state response', async () => {
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

  test('if the controller was unreachable on save, it is remembered on the first connection', async () => {
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

  test('with «Verify certificate» (CA) nothing is remembered', async () => {
    const ctl = await startFakeUnifi({ tls: A });
    const srv = await startServer({ env: { IPAM_AUTH: 'off' } });
    try {
      const s = await req(srv.base, 'PUT', '/api/unifi/config', { body: { url: ctl.url, key: ctl.key, site: 'default', insecure: false } });
      assert.equal(s.json.zertifikat, '');
    } finally { await srv.stop(); await ctl.stop(); }
  });
});
