'use strict';

// Container-Image und Compose-Vorlagen: statisch geprüft, weil das Image erst auf GitHub
// gebaut wird (.github/workflows/docker.yml).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lies = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Dockerfile: App, Startskript, Datenordner, Healthcheck', () => {
  const d = lies('Dockerfile');
  assert.match(d, /^FROM node:22-alpine$/m);
  assert.match(d, /^COPY app\/ \/app\/$/m);
  assert.match(d, /IPAM_DATA=\/data/);
  assert.match(d, /HEALTHCHECK[\s\S]*\/healthz/);
  assert.match(d, /ENTRYPOINT \["l3t-entrypoint"\]/);
  assert.match(d, /CMD \["node", "server.js"\]/);
});

test('.dockerignore lässt nur die App ins Image', () => {
  const ig = lies('.dockerignore').split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(ig[0], '*');
  assert.ok(ig.includes('!app/'));
  assert.ok(ig.includes('!docker/entrypoint.sh'));
});

test('Startskript: POSIX-Shell, Unix-Zeilenenden, gibt Root-Rechte ab', () => {
  const s = lies('docker/entrypoint.sh');
  assert.ok(s.startsWith('#!/bin/sh\n'));
  assert.ok(!s.includes('\r'), 'keine Windows-Zeilenenden');
  assert.match(s, /su-exec "\$PUID:\$PGID" "\$@"/);
});

test('Startskript ohne Root führt den Befehl direkt aus', { skip: process.platform === 'win32' && !fs.existsSync('C:/Program Files/Git/bin/sh.exe') }, () => {
  const sh = process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh';
  const out = execFileSync(sh, [path.join(ROOT, 'docker/entrypoint.sh'), 'echo', 'gestartet'], {
    env: { ...process.env, IPAM_DATA: path.join(require('node:os').tmpdir(), 'l3t-entry-test') },
  }).toString();
  // Unter Windows/Git-Bash ist id -u nie 0; auf Linux-CI ebenso, solange nicht als root.
  assert.match(out, /gestartet/);
});

test('Compose-Vorlagen nutzen das Image und den Datenordner', () => {
  for (const f of ['docker-compose.yml', 'deploy/synology/docker-compose.yml']) {
    const c = lies(f);
    assert.match(c, /image: ghcr\.io\/l3t-io\/ipam:2/, f);
    assert.match(c, /:\/data$/m, f);
    assert.doesNotMatch(c, /^\s*build\s*:/m, f);
    assert.doesNotMatch(c, /IPAM_PASS|IPAM_UNIFI_KEY/, `${f}: keine Geheimnisse in Vorlagen`);
  }
});

test('Workflow baut nur bei Versions-Tags, für amd64 und arm64', () => {
  const w = lies('.github/workflows/docker.yml');
  assert.match(w, /tags: \['v\*'\]/);
  assert.match(w, /platforms: linux\/amd64,linux\/arm64/);
  assert.doesNotMatch(w, /npm test/);
});
