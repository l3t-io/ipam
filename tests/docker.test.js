'use strict';

// Container image and Compose templates: checked statically, because the image is only
// built on GitHub (.github/workflows/docker.yml).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lies = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Dockerfile: app, entrypoint script, data folder, healthcheck', () => {
  const d = lies('Dockerfile');
  assert.match(d, /^FROM node:22-alpine$/m);
  assert.match(d, /^COPY app\/ \/app\/$/m);
  assert.match(d, /IPAM_DATA=\/data/);
  assert.match(d, /HEALTHCHECK[\s\S]*\/healthz/);
  assert.match(d, /ENTRYPOINT \["l3t-entrypoint"\]/);
  assert.match(d, /CMD \["node", "server.js"\]/);
});

test('.dockerignore lets only the app into the image', () => {
  const ig = lies('.dockerignore').split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(ig[0], '*');
  assert.ok(ig.includes('!app/'));
  assert.ok(ig.includes('!docker/entrypoint.sh'));
});

test('entrypoint script: POSIX shell, Unix line endings, drops root privileges', () => {
  const s = lies('docker/entrypoint.sh');
  assert.ok(s.startsWith('#!/bin/sh\n'));
  assert.ok(!s.includes('\r'), 'no Windows line endings');
  assert.match(s, /su-exec "\$PUID:\$PGID" "\$@"/);
});

test('entrypoint script tests writing as PUID before dropping root', () => {
  const s = lies('docker/entrypoint.sh');
  const probe = s.indexOf('su-exec "$PUID:$PGID" sh -c');
  assert.ok(probe > 0, 'write test as PUID:PGID');
  assert.ok(probe < s.indexOf('exec su-exec "$PUID:$PGID" "$@"'), 'test comes before the switch');
  assert.match(s, /may not write to \$DATA/);
});

test('entrypoint script without root runs the command directly', { skip: process.platform === 'win32' && !fs.existsSync('C:/Program Files/Git/bin/sh.exe') }, () => {
  const sh = process.platform === 'win32' ? 'C:/Program Files/Git/bin/sh.exe' : '/bin/sh';
  const out = execFileSync(sh, [path.join(ROOT, 'docker/entrypoint.sh'), 'echo', 'gestartet'], {
    env: { ...process.env, IPAM_DATA: path.join(require('node:os').tmpdir(), 'l3t-entry-test') },
  }).toString();
  // On Windows/Git Bash, id -u is never 0; likewise on Linux CI, as long as not run as root.
  assert.match(out, /gestartet/);
});

test('Compose templates use the image and the data folder', () => {
  for (const f of ['docker-compose.yml', 'deploy/synology/docker-compose.yml']) {
    const c = lies(f);
    assert.match(c, /image: ghcr\.io\/l3t-io\/ipam:2/, f);
    assert.match(c, /:\/data$/m, f);
    assert.doesNotMatch(c, /^\s*build\s*:/m, f);
    assert.doesNotMatch(c, /IPAM_PASS|IPAM_UNIFI_KEY/, `${f}: no secrets in templates`);
  }
});

test('workflow builds only on version tags, for amd64 and arm64', () => {
  const w = lies('.github/workflows/docker.yml');
  assert.match(w, /tags: \['v\*'\]/);
  assert.match(w, /platforms: linux\/amd64,linux\/arm64/);
  assert.doesNotMatch(w, /npm test/);
});
