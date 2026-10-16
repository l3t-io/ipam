'use strict';

// Translation: every UI text has an English version, placeholders match,
// and server messages are reliably translated back.

const { test, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18N = require('../app/public/i18n');

const { EN } = I18N;
const PUBLIC = path.join(__dirname, '..', 'app', 'public');
const lesen = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const platzhalter = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const ohneEscape = (s) => s.replace(/\\(.)/g, '$1');

after(() => I18N.setLang('de'));

// All keys from t('…'), t(`…`), tn(n, '…', '…') and data-i18n* attributes.
function schluessel() {
  const keys = new Map();
  const merken = (k, wo) => { if (!keys.has(k)) keys.set(k, wo); };
  for (const f of ['app.js', 'login.js', '../unifi-check.js']) {
    const s = lesen(f);
    for (const m of s.matchAll(/(?<![\w$.])t\(\s*'((?:[^'\\]|\\.)*)'/g)) merken(ohneEscape(m[1]), f);
    for (const m of s.matchAll(/(?<![\w$.])t\(\s*`([^`$]*)`/g)) merken(m[1], f);
    for (const m of s.matchAll(/(?<![\w$.])tn\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'/g)) {
      merken(ohneEscape(m[1]), f);
      merken(ohneEscape(m[2]), f);
    }
  }
  for (const f of ['index.html', 'login.html']) {
    for (const m of lesen(f).matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]*)"/g)) merken(m[1], f);
  }
  return keys;
}

test('every text from app.js, login.js and the HTML pages has an English version', () => {
  const keys = schluessel();
  assert.ok(keys.size > 250, `only ${keys.size} keys found — detection broken?`);
  const fehlt = [...keys].filter(([k]) => !Object.prototype.hasOwnProperty.call(EN, k)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(fehlt, []);
});

test('every English version has exactly the placeholders of its key', () => {
  const falsch = Object.entries(EN)
    .filter(([de, en]) => platzhalter(de).join() !== platzhalter(en).join())
    .map(([de, en]) => `${de} → ${en}`);
  assert.deepEqual(falsch, []);
});

test('no empty translations', () => {
  assert.deepEqual(Object.entries(EN).filter(([, en]) => typeof en !== 'string' || !en.trim()).map(([de]) => de), []);
});

test('tr() translates finished server messages', () => {
  I18N.setLang('en');
  assert.equal(I18N.tr('10.13.20.10 ist in diesem Netz bereits vergeben'), '10.13.20.10 is already taken in this network');
  assert.equal(I18N.tr('Zu viele Fehlversuche. Erneut möglich in 15 Min.'), 'Too many failed attempts. Try again in 15 min.');
  assert.equal(I18N.tr('6 Zonen gelesen, 5 von 6 Netzen zugeordnet — ohne Zone: Gast'),
    '6 zones read, 5 of 6 networks assigned — without zone: Gast');
  assert.equal(I18N.tr('6 Zonen gelesen, 6 von 6 Netzen zugeordnet'), '6 zones read, 6 of 6 networks assigned');
  assert.equal(I18N.tr('Benutzername oder Passwort falsch'), 'Wrong username or password');
  // Nested messages are translated as well.
  assert.equal(I18N.tr('Import abgebrochen: Name fehlt'), 'Import aborted: Name missing');
  assert.equal(I18N.tr('Netze nicht lesbar: Netzwerkfehler: Zeitüberschreitung'), 'Networks not readable: Network error: Timeout');
  // Longer patterns take precedence over shorter ones.
  assert.equal(I18N.tr('Benutzer «anna» gelöscht von «admin»'), 'User «anna» deleted by «admin»');
  // Unknown text stays unchanged.
  assert.equal(I18N.tr('ECONNREFUSED: connect ECONNREFUSED 10.1.1.1:443'), 'ECONNREFUSED: connect ECONNREFUSED 10.1.1.1:443');
  assert.equal(I18N.tr('Etwas völlig anderes'), 'Etwas völlig anderes');
  assert.equal(I18N.tr(''), '');
  assert.equal(I18N.tr(undefined), undefined);
  I18N.setLang('de');
  assert.equal(I18N.tr('Benutzername oder Passwort falsch'), 'Benutzername oder Passwort falsch');
});

test('tr() finds its way back for every pattern — no key shadows another', () => {
  I18N.setLang('en');
  const falsch = [];
  for (const [de, en] of Object.entries(EN)) {
    if (de.includes('|') || !/\{\w+\}/.test(de)) continue;
    const vars = {};
    platzhalter(de).forEach((name, i) => { vars[name] = I18N.ZAHLEN.has(name) ? String(7 + i) : `W${i}x`; });
    const deutsch = de.replace(/\{(\w+)\}/g, (m, k) => vars[k]);
    const erwartet = en.replace(/\{(\w+)\}/g, (m, k) => vars[k]);
    const ist = I18N.tr(deutsch);
    if (ist !== erwartet) falsch.push(`${deutsch} → ${ist} (erwartet: ${erwartet})`);
  }
  I18N.setLang('de');
  assert.deepEqual(falsch, []);
});

test('t() and tn() insert values, German stays the source text', () => {
  I18N.setLang('de');
  assert.equal(I18N.t('Passwort muss mindestens {n} Zeichen lang sein', { n: 12 }), 'Passwort muss mindestens 12 Zeichen lang sein');
  assert.equal(I18N.t('Rolle|Bearbeiten'), 'Bearbeiten');
  assert.equal(I18N.tn(1, '1 Eintrag', '{n} Einträge'), '1 Eintrag');
  assert.equal(I18N.tn(3, '1 Eintrag', '{n} Einträge'), '3 Einträge');
  assert.equal(I18N.locale(), 'de-CH');

  I18N.setLang('en');
  assert.equal(I18N.t('Passwort muss mindestens {n} Zeichen lang sein', { n: 12 }), 'Password must be at least 12 characters long');
  assert.equal(I18N.t('«{user}» gelöscht', { user: 'anna' }), '«anna» deleted');
  assert.equal(I18N.t('Rolle|Bearbeiten'), 'Editor');
  assert.equal(I18N.t('Bearbeiten'), 'Edit');
  assert.equal(I18N.tn(1, '1 Eintrag', '{n} Einträge'), '1 entry');
  assert.equal(I18N.tn(2, '1 Eintrag', '{n} Einträge', { n: '2' }), '2 entries');
  assert.equal(I18N.locale(), 'en-GB');
  // Missing translation: German text, placeholders still replaced.
  assert.equal(I18N.t('Gibt es nicht {x}', { x: 1 }), 'Gibt es nicht 1');
  // Unknown language is ignored.
  I18N.setLang('fr');
  assert.equal(I18N.getLang(), 'en');
  I18N.setLang('de');
});

describe('Log in English', () => {
  test('with IPAM_LANG=en, startup message and setup code come in English', async () => {
    // The test helper waits for «laeuft auf» — here wait specifically for the English output.
    const { spawn } = require('node:child_process');
    const path = require('node:path');
    const os = require('node:os');
    const fs = require('node:fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l3t-lang-'));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app', 'server.js')], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, IPAM_DATA: dir, IPAM_PORT: '0', IPAM_HOST: '127.0.0.1', IPAM_LANG: 'en' },
    });
    let logs = '';
    await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`kein Start:\n${logs}`)), 10000);
      child.stdout.on('data', (c) => { logs += c; if (/UniFi/.test(logs)) { clearTimeout(t); ok(); } });
    });
    child.kill();
    assert.doesNotMatch(logs, /laeuft auf|Einrichtungscode|Noch kein Konto/, logs);
    assert.match(logs, /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/, 'code is in the log');
  });
});
