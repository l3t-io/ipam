'use strict';

// Builds the Synology package: _exports/l3t-ipam-<version>-synology.zip
// No external dependencies, so it runs the same on Windows, macOS and Linux.
// Usage: npm run package   (optional: node scripts/package.js <target folder>)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const PREFIX = 'l3t-ipam/';

// What goes into the package. Everything else (tests, scripts, repo files) stays out.
// Entries are repo paths; [source, target] stores a file under a different name.
const COMPOSE = 'deploy/synology-mount/docker-compose.yml';
const INHALT = ['app', 'data/.keep', [COMPOSE, 'docker-compose.yml'], 'SYNOLOGY.md', 'SYNOLOGY.de.md', 'CHANGELOG.md', 'LICENSE'];
const PFLICHT = [
  'app/server.js', 'app/auth.js', 'app/unifi.js',
  'app/public/index.html', 'app/public/app.js', 'app/public/login.html', 'app/public/login.js', 'app/public/i18n.js',
  'app/public/style.css', 'app/public/logo.svg', 'app/public/icon.svg',
  COMPOSE, 'SYNOLOGY.md', 'SYNOLOGY.de.md', 'data/.keep', 'LICENSE',
];

function version() {
  const src = fs.readFileSync(path.join(ROOT, 'app/server.js'), 'utf8');
  const m = src.match(/const APP_VERSION = '([^']+)'/);
  if (!m) throw new Error('APP_VERSION in app/server.js nicht gefunden');
  return m[1];
}

// Checks for exactly the mistakes that have already happened in the past.
function pruefen() {
  for (const f of PFLICHT) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`Pflichtdatei fehlt: ${f}`);
  }
  const compose = fs.readFileSync(path.join(ROOT, COMPOSE), 'utf8');
  if (/^\s*build\s*:/m.test(compose)) throw new Error('docker-compose.yml enthält «build:» — Synology baut kein Image');
  if (!compose.includes('/volume1/docker/l3t-ipam/app:/app:ro')) throw new Error('Einhängepunkt für app/ fehlt');
  if (!compose.includes('/volume1/docker/l3t-ipam/data:/data')) throw new Error('Einhängepunkt für data/ fehlt');
  if (!compose.includes('/healthz')) throw new Error('Healthcheck zeigt nicht auf /healthz');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.version !== version()) throw new Error(`package.json (${pkg.version}) und APP_VERSION (${version()}) weichen ab`);
}

function sammeln() {
  const eintraege = [{ name: '', dir: true }]; // root folder l3t-ipam/
  const besuchen = (rel) => {
    const abs = path.join(ROOT, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      eintraege.push({ name: `${rel}/`, dir: true });
      for (const kind of fs.readdirSync(abs).sort()) besuchen(`${rel}/${kind}`);
    } else {
      eintraege.push({ name: rel, data: fs.readFileSync(abs) });
    }
  };
  for (const eintrag of INHALT) {
    if (Array.isArray(eintrag)) {
      eintraege.push({ name: eintrag[1], data: fs.readFileSync(path.join(ROOT, eintrag[0])) });
      continue;
    }
    const rel = eintrag;
    // Add parent folders of single files (such as data/) as entries of their own.
    const teile = rel.split('/');
    for (let i = 1; i < teile.length; i++) {
      const d = `${teile.slice(0, i).join('/')}/`;
      if (!eintraege.some((e) => e.name === d)) eintraege.push({ name: d, dir: true });
    }
    besuchen(rel);
  }
  return eintraege;
}

/* ---------- ZIP writer (PKZIP 2.0, Deflate) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosZeit(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zip(eintraege) {
  const { time, date } = dosZeit(new Date());
  const lokal = [];
  const zentral = [];
  let offset = 0;

  for (const e of eintraege) {
    const name = Buffer.from(PREFIX + e.name, 'utf8');
    const roh = e.dir ? Buffer.alloc(0) : e.data;
    const gepackt = e.dir ? roh : zlib.deflateRawSync(roh, { level: 9 });
    const methode = e.dir ? 0 : 8;
    const crc = e.dir ? 0 : crc32(roh);
    // Unix permissions, so the Synology sets sensible modes when extracting.
    const attr = ((e.dir ? 0o40755 : 0o100644) << 16) >>> 0 | (e.dir ? 0x10 : 0);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // file names in UTF-8
    lh.writeUInt16LE(methode, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(gepackt.length, 18);
    lh.writeUInt32LE(roh.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    lokal.push(lh, name, gepackt);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4); // made on Unix, version 2.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(methode, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(gepackt.length, 20);
    ch.writeUInt32LE(roh.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(attr >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    zentral.push(ch, name);

    offset += lh.length + name.length + gepackt.length;
  }

  const cd = Buffer.concat(zentral);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(cd.length, 12);
  ende.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, cd, ende]);
}

function main() {
  pruefen();
  const ziel = path.resolve(process.argv[2] || path.join(ROOT, '_exports'));
  fs.mkdirSync(ziel, { recursive: true });
  const datei = path.join(ziel, `l3t-ipam-${version()}-synology.zip`);
  const eintraege = sammeln();
  fs.writeFileSync(datei, zip(eintraege));
  console.log(`${path.relative(process.cwd(), datei) || datei} — ${eintraege.filter((e) => !e.dir).length} Dateien`);
  return datei;
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(`Paketierung abgebrochen: ${err.message}`); process.exit(1); }
}

module.exports = { main, version, crc32 };
