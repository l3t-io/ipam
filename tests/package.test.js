'use strict';

// Checks the finished Synology package before anyone uploads it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { tempDir } = require('./helpers');
const { crc32 } = require('../scripts/package');

const ROOT = path.join(__dirname, '..');

// Minimal reader for the central directory.
function lesen(buf) {
  const ende = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const anzahl = buf.readUInt16LE(ende + 10);
  let p = buf.readUInt32LE(ende + 16);
  const dateien = new Map();
  for (let i = 0; i < anzahl; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const methode = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const groesse = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const klen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const roh = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + groesse);
    const inhalt = methode === 8 ? zlib.inflateRawSync(roh) : roh;
    dateien.set(name, { crc, inhalt });
    p += 46 + nlen + xlen + klen;
  }
  return dateien;
}

test('Synology package is complete and clean', () => {
  const ziel = tempDir();
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'package.js'), ziel], { stdio: 'pipe' });
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const datei = path.join(ziel, `l3t-ipam-${version}-synology.zip`);
  assert.ok(fs.existsSync(datei), 'ZIP missing');

  const zip = lesen(fs.readFileSync(datei));
  const namen = [...zip.keys()];

  for (const n of namen) {
    assert.ok(n.startsWith('l3t-ipam/'), `everything under l3t-ipam/: ${n}`);
    assert.ok(!n.includes('\\'), `only forward slashes in the path: ${n}`);
  }
  for (const pflicht of [
    'l3t-ipam/app/server.js', 'l3t-ipam/app/auth.js', 'l3t-ipam/app/unifi.js',
    'l3t-ipam/app/public/index.html', 'l3t-ipam/app/public/login.html', 'l3t-ipam/app/public/login.js', 'l3t-ipam/app/public/i18n.js',
    'l3t-ipam/app/public/fonts/plex-mono-400.woff2', 'l3t-ipam/docker-compose.yml',
    'l3t-ipam/SYNOLOGY.md', 'l3t-ipam/SYNOLOGY.de.md', 'l3t-ipam/data/.keep', 'l3t-ipam/LICENSE',
  ]) assert.ok(zip.has(pflicht), `missing: ${pflicht}`);

  // No data, no tests, no repo internals.
  for (const n of namen) {
    assert.ok(!/data\/.+\.json$/.test(n), `leftover data in the package: ${n}`);
    assert.ok(!/\/(tests|scripts|\.git|\.github)\//.test(n), `does not belong in the package: ${n}`);
  }

  // Contents match the working tree 1:1.
  for (const [n, { crc, inhalt }] of zip) {
    if (n.endsWith('/')) continue;
    const rel = n.slice('l3t-ipam/'.length);
    const quelle = fs.readFileSync(path.join(ROOT, rel === 'docker-compose.yml' ? 'deploy/synology-mount/docker-compose.yml' : rel));
    assert.ok(inhalt.equals(quelle), `content differs: ${n}`);
    assert.equal(crc, crc32(quelle), `wrong checksum: ${n}`);
  }

  const compose = zip.get('l3t-ipam/docker-compose.yml').inhalt.toString('utf8');
  assert.doesNotMatch(compose, /^\s*build\s*:/m, 'Synology Compose must not build an image');
  assert.match(compose, /\/healthz/);
});

test('version in package.json and server.js match', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const src = fs.readFileSync(path.join(ROOT, 'app', 'server.js'), 'utf8');
  assert.equal(src.match(/const APP_VERSION = '([^']+)'/)[1], pkg);
});
