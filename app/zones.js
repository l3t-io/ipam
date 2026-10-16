'use strict';

// Security zones as first-class records.
//
// A zone has a name, a colour and an optional description. Networks reference their zone by
// name (vlan.zone). Zones come from two sources:
//   - 'unifi': created automatically from the controller's zone-based firewall. The name is
//     owned by UniFi and can't be changed here; colour and description can.
//   - 'manuell': created by hand (or implicitly when a network is given a new zone name).
//     Fully editable and deletable.
//
// Colours are either a key of the validated palette (light/dark variants live in style.css)
// or a custom hex colour (#RRGGBB).

const crypto = require('node:crypto');

// Validated palette — distinguishable pairwise in light and dark mode (see CHANGELOG 1.14.0).
const PALETTE = ['rot', 'bernstein', 'gruen', 'blau', 'violett', 'rosa', 'grau'];

// Well-known zone names get their established colour.
const PRESETS = {
  dmz: 'rot', hotspot: 'bernstein', internal: 'gruen', management: 'blau', mgmt: 'blau',
  multimedia: 'violett', media: 'violett', server: 'rosa', servers: 'rosa', vpn: 'grau',
};

// Zones of the zone-based firewall that never hold networks of their own.
const SYSTEM_ZONES = new Set(['external', 'gateway']);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const istFarbe = (c) => PALETTE.includes(c) || HEX_RE.test(c);
const schluessel = (name) => String(name || '').trim().toLowerCase();
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Colour for a new zone: preset by name, otherwise the least used palette colour (first in
// palette order on a tie). Past seven zones colours repeat; a custom colour helps there.
function startfarbe(name, zonen) {
  const preset = PRESETS[schluessel(name)];
  if (preset) return preset;
  const anzahl = (p) => zonen.filter((z) => z.color === p).length;
  return PALETTE.reduce((best, p) => (anzahl(p) < anzahl(best) ? p : best));
}

const findeZone = (zonen, name) => zonen.find((z) => schluessel(z.name) === schluessel(name));

// Validates user input for a zone. Throws with a message for the UI.
function cleanZone(input, existing = null, zonen = []) {
  const name = existing && existing.quelle === 'unifi' ? existing.name : str(input.name, 40);
  if (!name) throw new Error('Name der Zone fehlt');
  const doppelt = findeZone(zonen, name);
  if (doppelt && (!existing || doppelt.id !== existing.id)) throw new Error(`Die Zone «${name}» gibt es schon`);
  const color = input.color === undefined && existing ? existing.color : String(input.color || '');
  if (!istFarbe(color)) throw new Error('Unbekannte Farbe');
  const now = new Date().toISOString();
  return {
    id: existing ? existing.id : crypto.randomUUID(),
    name,
    color: HEX_RE.test(color) ? color.toUpperCase() : color,
    beschreibung: input.beschreibung === undefined && existing ? existing.beschreibung : str(input.beschreibung, 120),
    quelle: existing ? existing.quelle : 'manuell',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
}

// Makes sure a zone with this name exists. Returns { zone, neu }.
function sicherstellen(state, name, quelle = 'manuell') {
  if (!Array.isArray(state.zones)) state.zones = [];
  const vorhanden = findeZone(state.zones, name);
  if (vorhanden) return { zone: vorhanden, neu: false };
  const now = new Date().toISOString();
  const zone = {
    id: crypto.randomUUID(), name: str(name, 40), color: startfarbe(name, state.zones),
    beschreibung: '', quelle, createdAt: now, updatedAt: now,
  };
  state.zones.push(zone);
  return { zone, neu: true };
}

// Loaded or imported data: keep valid zone records, create missing ones for networks that
// already name a zone (data from before 2.1), and write each network's zone name exactly as
// the zone spells it. Returns true if something changed.
function migrieren(state) {
  const vorher = JSON.stringify([state.zones, state.vlans.map((v) => v.zone)]);
  const roh = Array.isArray(state.zones) ? state.zones : [];
  state.zones = [];
  for (const z of roh) {
    if (!z || typeof z !== 'object') continue;
    const name = str(z.name, 40);
    if (!name || findeZone(state.zones, name)) continue;
    state.zones.push({
      id: typeof z.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(z.id) ? z.id : crypto.randomUUID(),
      name,
      color: istFarbe(z.color) ? z.color : startfarbe(name, state.zones),
      beschreibung: str(z.beschreibung, 120),
      quelle: z.quelle === 'unifi' ? 'unifi' : 'manuell',
      createdAt: typeof z.createdAt === 'string' ? z.createdAt.slice(0, 40) : new Date().toISOString(),
      updatedAt: typeof z.updatedAt === 'string' ? z.updatedAt.slice(0, 40) : new Date().toISOString(),
    });
  }
  // Well-known names first, so they get their preset colour before others pick from the palette.
  const reihenfolge = [...state.vlans].sort((x, y) => Number(!PRESETS[schluessel(x.zone)]) - Number(!PRESETS[schluessel(y.zone)]));
  for (const v of reihenfolge) {
    if (!v.zone) continue;
    const { zone } = sicherstellen(state, v.zone, v.zoneAusUnifi ? 'unifi' : 'manuell');
    v.zone = zone.name;
  }
  return JSON.stringify([state.zones, state.vlans.map((v) => v.zone)]) !== vorher;
}

// Renaming a manual zone carries its networks along.
function umbenennen(state, alt, neu) {
  for (const v of state.vlans) if (schluessel(v.zone) === schluessel(alt)) v.zone = neu;
}

// Deleting a zone leaves its networks without a zone; they show their own colour again.
function entfernen(state, zone) {
  state.zones = state.zones.filter((z) => z.id !== zone.id);
  let frei = 0;
  for (const v of state.vlans) {
    if (schluessel(v.zone) === schluessel(zone.name)) { v.zone = ''; v.zoneAusUnifi = false; frei++; }
  }
  return frei;
}

module.exports = {
  PALETTE, PRESETS, SYSTEM_ZONES, istFarbe, cleanZone, sicherstellen, migrieren, umbenennen, entfernen, findeZone,
};
