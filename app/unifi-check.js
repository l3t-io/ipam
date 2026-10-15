#!/usr/bin/env node
'use strict';

// Diagnose der UniFi-Anbindung. Zeigt, was gelesen werden konnte und was nicht.
// Aufruf im Container (z. B. Container Manager → Container → l3t-ipam → Terminal):
//   node unifi-check.js
// Liest dieselben Zugangsdaten wie die Anwendung: zuerst data/unifi.json aus der
// Oberfläche, sonst die IPAM_UNIFI_*-Variablen. Sprache wie das Protokoll: IPAM_LANG.

const path = require('node:path');
const unifi = require('./unifi');
const I18N = require('./public/i18n.js');

I18N.setLang(String(process.env.IPAM_LANG || 'en').toLowerCase().startsWith('de') ? 'de' : 'en');
const { t, tr } = I18N;

unifi.init(process.env.IPAM_DATA || path.join(__dirname, '..', 'data'));
const c = unifi.CFG();
const herkunft = {
  web: t('Oberfläche (data/unifi.json)'), umgebung: t('Compose-Datei'), keine: '—',
}[unifi.source()];

// Zweispaltig: Bezeichnung links, auf gleiche Breite gebracht
const zeile = (label, wert) => console.log(`${`${label}:`.padEnd(18)} ${wert}`);

const zertifikat = () => {
  if (!c.url) return '—';
  if (!c.insecure) return t('wird über eine Zertifizierungsstelle geprüft');
  if (!String(c.url).startsWith('https:')) return t('keines (HTTP)');
  return c.pin ? t('gemerkt: {fp}', { fp: c.pin }) : t('noch nicht gemerkt — wird beim nächsten Abruf gemerkt');
};

console.log(`${t('l3t ipam — UniFi-Diagnose')}\n`);
zeile(t('Eingestellt in'), herkunft);
zeile(t('Controller'), c.url || t('(nicht gesetzt)'));
zeile(t('API-Schlüssel'), c.key ? t('gesetzt ({n} Zeichen)', { n: c.key.length }) : t('(nicht gesetzt)'));
zeile(t('Konto'), c.user ? c.user : t('(nicht gesetzt, nur als Rückfall nötig)'));
zeile(t('Site'), c.site);
zeile(t('Zertifikat'), zertifikat());
console.log();

if (!unifi.isConfigured()) {
  console.log(t('Es fehlen Zugangsdaten. In der Oberfläche unter Einstellungen → UniFi eintragen.'));
  process.exit(1);
}

unifi.fetchAll({ refresh: true }).then((d) => {
  console.log(t('Verbindung steht.'));
  zeile(t('Network-Version'), d.version || t('unbekannt'));
  zeile(t('Site'), d.site);
  zeile(t('Gelesen über'), d.quellen.map(tr).join(', ') || t('keine Quelle'));
  zeile(t('Zonen'), d.zonenInfo ? tr(d.zonenInfo) : '—');
  if (d.warnungen.length) {
    console.log(`\n${t('Warnungen')}:`);
    for (const w of d.warnungen) console.log('  -', tr(w));
  }

  console.log(`\n${t('Netze ({n})', { n: d.networks.length })}:`);
  for (const n of d.networks) {
    console.log(`  VLAN ${String(n.vid).padStart(4)}  ${n.cidr.padEnd(18)} ${n.gateway.padEnd(15)} ${(n.zone || '–').padEnd(10)} ${n.name}`);
  }

  console.log(`\n${t('UniFi-Geräte ({n})', { n: d.devices.length })}:`);
  for (const g of d.devices) {
    console.log(`  ${g.ip.padEnd(16)} ${(g.mac || '').padEnd(18)} ${(g.model || '').padEnd(12)} ${g.name}`);
  }

  console.log(`\n${t('Feste Reservierungen ({n})', { n: d.reservations.length })}:`);
  for (const r of d.reservations.slice(0, 20)) {
    console.log(`  ${r.ip.padEnd(16)} ${(r.mac || '').padEnd(18)} ${r.name || r.hostname || ''}`);
  }
  if (d.reservations.length > 20) console.log(`  ${t('… und {n} weitere', { n: d.reservations.length - 20 })}`);

  console.log(`\n${t('Aktuell verbunden: {n} Clients', { n: d.live.length })}`);

  if (!d.networks.length) {
    console.log(`\n${t('Hinweis: Es kamen keine Netze zurück. Meist fehlt dem Konto hinter dem Schlüssel die Berechtigung, oder die Site heisst anders — dann in den Einstellungen anpassen.')}`);
  }
}).catch((err) => {
  zeile(t('Fehlgeschlagen'), tr(err.message));
  console.log(`\n${t('Häufige Ursachen')}:`);
  console.log(`  - ${t('Schlüssel abgelehnt → in UniFi neu erzeugen, das Konto braucht Administratorrechte')}`);
  console.log(`  - ${t('ECONNREFUSED / Zeitüberschreitung → Adresse falsch, oder das Netz darf den Controller nicht erreichen')}`);
  console.log(`  - ${t('Zertifikat geändert → nach einem Update des Controllers die Anbindung in den Einstellungen erneut speichern')}`);
  console.log(`  - ${t('404 auf allen Pfaden → Network-App älter als 9.3; dann ein Konto per IPAM_UNIFI_USER und IPAM_UNIFI_PASS hinterlegen')}`);
  process.exit(1);
});
