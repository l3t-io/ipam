'use strict';

// Release notes for a version, taken from CHANGELOG.md: the version's section plus install
// lines. Used by the release workflow; also handy locally.
//   node scripts/release-notes.js            → notes for APP_VERSION
//   node scripts/release-notes.js 2.1.2      → notes for that version
//   node scripts/release-notes.js --check v2.1.2   → fails unless the tag matches APP_VERSION,
//                                                     package.json and has a changelog entry

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function appVersion() {
  const src = fs.readFileSync(path.join(ROOT, 'app/server.js'), 'utf8');
  const m = src.match(/const APP_VERSION = '([^']+)'/);
  if (!m) throw new Error('APP_VERSION not found in app/server.js');
  return m[1];
}

// The text between «## <version> …» and the next «## » heading, without the heading.
function abschnitt(changelog, version) {
  const zeilen = changelog.split(/\r?\n/);
  const start = zeilen.findIndex((z) => z.startsWith(`## ${version} `) || z === `## ${version}`);
  if (start === -1) return null;
  const ende = zeilen.findIndex((z, i) => i > start && z.startsWith('## '));
  return zeilen.slice(start + 1, ende === -1 ? undefined : ende).join('\n').trim();
}

// The changelog is hard-wrapped at ~90 characters; GitHub shows every line break in release
// notes. Join continuation lines back into their paragraph or list item (code blocks stay).
function entfalten(text) {
  const out = [];
  let code = false;
  for (const zeile of text.split('\n')) {
    if (zeile.trimStart().startsWith('```')) code = !code;
    const fortsetzung = !code && out.length && zeile.trim() && !/^\s*([-*#|>]|\d+\.|```)/.test(zeile)
      && out[out.length - 1].trim() && !out[out.length - 1].trimStart().startsWith('#')
      && !out[out.length - 1].trimStart().startsWith('```');
    if (fortsetzung) out[out.length - 1] += ` ${zeile.trim()}`;
    else out.push(zeile);
  }
  return out.join('\n');
}

function notes(version) {
  const text = abschnitt(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!text) throw new Error(`No changelog entry for ${version}`);
  const major = version.split('.')[0];
  return `${entfalten(text)}

---

- **Docker:** \`docker pull ghcr.io/l3t-io/ipam:${version}\` (or \`:${major}\` to follow all ${major}.x releases)
- **Synology:** the attached ZIP is the mounted-code variant, see the [Synology guide](https://github.com/l3t-io/ipam/blob/main/SYNOLOGY.md)
- **All changes:** [CHANGELOG.md](https://github.com/l3t-io/ipam/blob/main/CHANGELOG.md)
`;
}

function check(tag) {
  const version = String(tag).replace(/^refs\/tags\//, '').replace(/^v/, '');
  const app = appVersion();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (version !== app) throw new Error(`Tag ${tag} does not match APP_VERSION ${app}`);
  if (version !== pkg) throw new Error(`Tag ${tag} does not match package.json ${pkg}`);
  notes(version); // throws without a changelog entry
  return version;
}

if (require.main === module) {
  try {
    const [arg1, arg2] = process.argv.slice(2);
    if (arg1 === '--check') console.log(check(arg2));
    else process.stdout.write(notes(arg1 || appVersion()));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { abschnitt, entfalten, notes, check, appVersion };
