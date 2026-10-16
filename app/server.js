'use strict';

// l3t-ipam - minimal IPAM
// Node >= 18, no external dependencies.

const APP_VERSION = '2.1.0';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const unifi = require('./unifi');
const zones = require('./zones');
const { createAuth } = require('./auth');

const PORT = Number(process.env.IPAM_PORT || 8080);
const HOST = process.env.IPAM_HOST || '0.0.0.0';
const DATA_DIR = process.env.IPAM_DATA || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'ipam.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DOMAIN = process.env.IPAM_DOMAIN || 'home.arpa';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const DEFAULT_SETTINGS = { theme: 'auto', offline: { ...unifi.OFFLINE_VORGABE } };
const COLORS = ['blau', 'kupferton', 'gruen', 'braun', 'schiefer', 'violett'];
// The colour ends up as a CSS variable in the style attribute — allow known names only.
const farbe = (c) => (COLORS.includes(c) ? c : c === 'orange' ? 'kupferton' : 'blau');
const EMPTY = { version: 1, settings: { ...DEFAULT_SETTINGS }, zones: [], vlans: [], hosts: [], ignoriert: [] };

let state = null;
let writeChain = Promise.resolve();
let letzteFrischeAbfrage = 0; // «Neu abfragen» (refresh) at most every five seconds

// Log language: IPAM_LANG=de or en (default). Messages are written in German and
// translated through the same dictionary as the UI.
const I18N = require('./public/i18n.js');
I18N.setLang(String(process.env.IPAM_LANG || 'en').toLowerCase().startsWith('de') ? 'de' : 'en');

function log(...a) {
  const text = a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ');
  console.log(new Date().toISOString(), I18N.tr(text));
}

async function loadState() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      version: 1,
      settings: {
        ...DEFAULT_SETTINGS, ...(parsed.settings || {}),
        offline: { ...DEFAULT_SETTINGS.offline, ...(parsed.settings?.offline || {}) },
      },
      zones: Array.isArray(parsed.zones) ? parsed.zones : [],
      vlans: Array.isArray(parsed.vlans) ? parsed.vlans : [],
      hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
      // Dismissed notices from the UniFi comparison
      ignoriert: Array.isArray(parsed.ignoriert) ? parsed.ignoriert : [],
    };
    log(`geladen: ${state.vlans.length} VLANs, ${state.hosts.length} Hosts`);
    // Zones became records in 2.1: create them for networks that only carry a zone name.
    if (zones.migrieren(state)) {
      await persist();
      log(`Zonen eingerichtet: ${state.zones.length}`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log('WARNUNG: ipam.json unlesbar, starte leer:', err.message);
      const bak = `${DATA_FILE}.broken-${Date.now()}`;
      try { await fsp.rename(DATA_FILE, bak); log('Defekte Datei gesichert als', bak); } catch {}
    }
    state = structuredClone(EMPTY);
    await persist();
  }
}

// Serialised, atomic writes.
function persist() {
  writeChain = writeChain.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tmp, DATA_FILE);
  }).catch((err) => log('Schreibfehler:', err.message));
  return writeChain;
}

function backupOnce() {
  // Daily copy, so a slip in the UI isn't final.
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(DATA_DIR, `ipam-${stamp}.bak.json`);
  if (fs.existsSync(DATA_FILE) && !fs.existsSync(dest)) {
    try { fs.copyFileSync(DATA_FILE, dest); fs.chmodSync(dest, 0o600); } catch {}
  }
  // Keep only the last 14 backups.
  try {
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.bak.json')).sort();
    while (files.length > 14) fs.unlinkSync(path.join(DATA_DIR, files.shift()));
  } catch {}
}

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const IMPORT_LIMIT = 8 * 1024 * 1024;
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        // Stop reading; the caller responds with 413 and closes the connection.
        req.pause();
        const err = new Error('Anfrage zu gross');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Ungueltiges JSON')); }
    });
    req.on('error', reject);
  });
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// IDs end up in URLs (/api/hosts/<id>). Harmless characters only — otherwise a new one is
// assigned. The browser would resolve an ID like «../users/<uid>» to a different endpoint.
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const gueltigeId = (id) => (typeof id === 'string' && ID_RE.test(id) ? id : crypto.randomUUID());
const zeitpunkt = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : new Date().toISOString());

function cleanVlan(input, existing = {}) {
  const vlan = {
    id: gueltigeId(existing.id),
    vid: Number.isFinite(Number(input.vid)) ? Math.max(0, Math.min(4094, Math.trunc(Number(input.vid)))) : existing.vid ?? 0,
    name: str(input.name, 80) || existing.name || '',
    cidr: str(input.cidr, 60) || existing.cidr || '',
    gateway: str(input.gateway, 60),
    dhcpFrom: str(input.dhcpFrom, 60),
    dhcpTo: str(input.dhcpTo, 60),
    color: farbe(str(input.color, 20) || existing.color),
    // A zone from UniFi is only changed there, not here.
    zone: existing.zoneAusUnifi ? str(existing.zone, 40) : str(input.zone, 40),
    zoneAusUnifi: existing.zoneAusUnifi === true,
    purpose: str(input.purpose, 200),
    notes: str(input.notes, 4000),
    createdAt: zeitpunkt(existing.createdAt),
    updatedAt: new Date().toISOString(),
  };
  if (!vlan.name) throw new Error('Name fehlt');
  if (!vlan.cidr) throw new Error('Subnetz (CIDR) fehlt');
  return vlan;
}

function cleanHost(input, existing = {}) {
  const host = {
    id: gueltigeId(existing.id),
    vlanId: str(input.vlanId, 60) || existing.vlanId || '',
    ip: str(input.ip, 60) || existing.ip || '',
    hostname: str(input.hostname, 80),
    fqdn: str(input.fqdn, 200),
    mac: str(input.mac, 40),
    role: str(input.role, 60),
    kind: ['statisch', 'dhcp', 'reserviert'].includes(input.kind) ? input.kind : (existing.kind || 'statisch'),
    // Only checks in now and then (e.g. battery devices): never clean up as offline.
    sporadisch: input.sporadisch === true,
    notes: str(input.notes, 4000),
    createdAt: zeitpunkt(existing.createdAt),
    updatedAt: new Date().toISOString(),
  };
  if (!host.vlanId) throw new Error('VLAN fehlt');
  if (!host.ip) throw new Error('IP fehlt');
  if (!state.vlans.some((v) => v.id === host.vlanId)) throw new Error('VLAN existiert nicht');
  return host;
}

// A network named a zone that doesn't exist yet: create it, and use its exact spelling.
function zoneZuordnen(vlan) {
  if (vlan.zone) vlan.zone = zones.sicherstellen(state, vlan.zone, 'manuell').zone.name;
  return vlan;
}

const belegt = (vlanId, ip, ausserId) =>
  state.hosts.some((h) => h.vlanId === vlanId && h.ip === ip && h.id !== ausserId);

// Dismissed notices: «In UniFi prüfen» (chk:…) and anomalies from the overview (auf:…).
const HINWEIS_KEY = [
  /^chk:[\d.]+\|[0-9a-f:]{17}$/,
  /^auf:(pool|ipdup|mac|ausserhalb|overlap|gateway|zone|name):[0-9A-Za-z.:|-]{1,160}$/,
];

async function hinweiseAusblenden(req, res, url) {
  if (req.method === 'POST') {
    const body = await readBody(req, 4096);
    const key = str(body.key, 200);
    if (!HINWEIS_KEY.some((re) => re.test(key))) throw new Error('Unbekannter Hinweis');
    if (!state.ignoriert.some((i) => i.key === key)) {
      state.ignoriert.push({ key, name: str(body.name, 120), at: new Date().toISOString() });
      if (state.ignoriert.length > 1000) state.ignoriert.shift();
      await persist();
    }
    return send(res, 200, { ok: true, anzahl: state.ignoriert.length });
  }
  if (req.method === 'DELETE') {
    // ?art=auf or ?art=chk shows only that kind again
    const art = url.searchParams.get('art');
    const vorher = state.ignoriert.length;
    state.ignoriert = art ? state.ignoriert.filter((i) => !i.key.startsWith(`${art}:`)) : [];
    await persist();
    return send(res, 200, { ok: true, eingeblendet: vorher - state.ignoriert.length });
  }
  return send(res, 405, { error: 'Methode nicht erlaubt' });
}

async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', 'vlans', ':id']
  const kind = seg[1];
  const id = seg[2];
  const method = req.method;

  if (kind === 'state' && method === 'GET') {
    return send(res, 200, { ...state, domain: DEFAULT_DOMAIN, version: APP_VERSION, unifi: unifi.isConfigured() });
  }

  if (kind === 'export' && method === 'GET') {
    const name = `ipam-${new Date().toISOString().slice(0, 10)}.json`;
    return send(res, 200, JSON.stringify({ ...state, exportedBy: `l3t-ipam ${APP_VERSION}` }, null, 2), {
      'Content-Disposition': `attachment; filename="${name}"`,
    });
  }

  if (kind === 'import' && method === 'POST') {
    const body = await readBody(req, IMPORT_LIMIT);
    if (!Array.isArray(body.vlans) || !Array.isArray(body.hosts)) throw new Error('Erwartet: vlans[] und hosts[]');
    backupOnce();
    const before = state;
    try {
      const vergeben = new Set();
      const eindeutig = (id) => {
        const neu = gueltigeId(id);
        const ok = vergeben.has(neu) ? crypto.randomUUID() : neu;
        vergeben.add(ok);
        return ok;
      };
      const netzId = new Map();
      const vlans = body.vlans.map((v) => {
        const c = cleanVlan(v, { ...v, id: eindeutig(v && v.id) });
        netzId.set(v && v.id, c.id);
        return c;
      });
      state = {
        version: 1, settings: before.settings, zones: Array.isArray(body.zones) ? body.zones : [], vlans, hosts: [],
        ignoriert: before.ignoriert || [],
      };
      zones.migrieren(state);
      state.hosts = body.hosts.map((h) => cleanHost({ ...h, vlanId: netzId.has(h && h.vlanId) ? netzId.get(h.vlanId) : '' },
        { ...h, id: eindeutig(h && h.id) }));
    } catch (err) {
      state = before;
      throw new Error(`Import abgebrochen: ${err.message}`);
    }
    await persist();
    return send(res, 200, { ...state, domain: DEFAULT_DOMAIN, version: APP_VERSION });
  }

  if (kind === 'hosts' && id === 'dedupe' && method === 'POST') {
    // One entry remains per network and address. The most informative one is kept;
    // fields that only the discarded entry has are carried over.
    const gewicht = (h) => (h.kind === 'statisch' ? 100 : 0) +
      ['hostname', 'fqdn', 'mac', 'role', 'notes'].filter((f) => h[f]).length;
    const gruppen = new Map();
    for (const h of state.hosts) {
      const k = `${h.vlanId}|${h.ip}`;
      if (!gruppen.has(k)) gruppen.set(k, []);
      gruppen.get(k).push(h);
    }
    const behalten = [];
    let entfernt = 0;
    for (const gruppe of gruppen.values()) {
      if (gruppe.length === 1) { behalten.push(gruppe[0]); continue; }
      const sortiert = gruppe.slice().sort((a, b) => gewicht(b) - gewicht(a));
      const sieger = { ...sortiert[0] };
      for (const rest of sortiert.slice(1)) {
        for (const f of ['hostname', 'fqdn', 'mac', 'role', 'notes']) {
          if (!sieger[f] && rest[f]) sieger[f] = rest[f];
        }
      }
      behalten.push(sieger);
      entfernt += gruppe.length - 1;
    }
    if (entfernt) {
      backupOnce();
      state.hosts = behalten;
      await persist();
    }
    return send(res, 200, { entfernt });
  }

  if (kind === 'ignore') return hinweiseAusblenden(req, res, url);

  if (kind === 'unifi') {
    const what = seg[2];

    if (what === 'config') {
      if (method === 'GET') return send(res, 200, unifi.publicConfig());
      if (method === 'PUT') {
        const cfg = await unifi.saveConfig(await readBody(req, 16 * 1024));
        log(`UniFi-Anbindung in der Oberfläche gespeichert: ${cfg.url}, Site ${cfg.site}`);
        return send(res, 200, cfg);
      }
      if (method === 'DELETE') {
        const cfg = await unifi.clearConfig();
        log('UniFi-Anbindung aus der Oberfläche entfernt');
        return send(res, 200, cfg);
      }
    }

    if (what === 'offline') {
      const sub = seg[3];
      if (!sub && method === 'GET') {
        const data = await unifiLesen();
        return send(res, 200, unifi.offlineKandidaten(state, data));
      }
      if (!sub && method === 'PUT') {
        const body = await readBody(req, 4096);
        const tage = Math.trunc(Number(body.tage));
        if (!Number.isFinite(tage) || tage < 1 || tage > 3650) throw new Error('Frist: 1 bis 3650 Tage');
        state.settings.offline = { auto: body.auto === true, tage, alleTypen: body.alleTypen === true };
        await persist();
        log(`Offline-Aufräumen: ${state.settings.offline.auto ? `automatisch nach ${tage} Tagen` : 'nur von Hand'}` +
          `${state.settings.offline.alleTypen ? ', alle Typen' : ', nur DHCP'}`);
        return send(res, 200, state.settings.offline);
      }
      if (sub === 'run' && method === 'POST') {
        return send(res, 200, await offlineAufraeumen({ vonHand: true }));
      }
    }

    // Dismiss «In UniFi prüfen» notices, or show all of them again.
    if (what === 'ignore') return hinweiseAusblenden(req, res, url);

    // Tries out the input before it is saved.
    if (what === 'test' && method === 'POST') {
      const config = unifi.withKnownKey(await readBody(req, 16 * 1024));
      try {
        const d = await unifi.fetchAll({ config });
        const zertifikat = config.url.startsWith('https:') ? await unifi.zertifikatLesen(config.url).catch(() => '') : '';
        return send(res, 200, {
          ok: true, zertifikat, version: d.version, site: d.site, quellen: d.quellen, warnungen: d.warnungen,
          netze: d.networks.length, geraete: d.devices.length, live: d.live.length,
        });
      } catch (err) {
        return send(res, 200, { ok: false, error: err.message });
      }
    }

    if (what === 'status' && method === 'GET') {
      if (!unifi.isConfigured()) return send(res, 200, { configured: false });
      try {
        const data = await unifiLesen();
        return send(res, 200, {
          configured: true, ok: true, controller: data.controller, version: data.version,
          site: data.site, quellen: data.quellen, warnungen: data.warnungen,
          netze: data.networks.length, reservierungen: data.reservations.length,
          geraete: data.devices.length, live: data.live.length,
          at: data.at,
        });
      } catch (err) {
        return send(res, 200, { configured: true, ok: false, error: err.message });
      }
    }

    if (what === 'diff' && method === 'GET') {
      const data = await unifiLesen({ refresh: url.searchParams.get('refresh') === '1' && Date.now() - letzteFrischeAbfrage > 5000 });
      if (url.searchParams.get('refresh') === '1') letzteFrischeAbfrage = Date.now();
      return send(res, 200, unifi.diff(state, data));
    }

    if (what === 'live' && method === 'GET') {
      if (!unifi.isConfigured()) return send(res, 200, { live: [] });
      try {
        const info = {};
        const data = await unifiLesen(undefined, info);
        const alle = new Map();
        for (const l of data.live) alle.set(l.ip, { ip: l.ip, mac: l.mac, name: l.name || l.hostname });
        for (const g of data.devices) alle.set(g.ip, { ip: g.ip, mac: g.mac, name: g.name || g.model });
        return send(res, 200, { live: [...alle.values()], zuletzt: unifi.zuletztGesehen(data), zonenGeaendert: info.zonen, at: data.at });
      } catch {
        return send(res, 200, { live: [] });
      }
    }

    if (what === 'apply' && method === 'POST') {
      const body = await readBody(req, 1024 * 1024);
      const keys = new Set(Array.isArray(body.keys) ? body.keys : []);
      if (!keys.size) throw new Error('Keine Auswahl übergeben');

      // The comparison is recomputed on the server, so that only what actually differs
      // is applied.
      const data = await unifiLesen({ refresh: true });
      const d = unifi.diff(state, data);
      const angewendet = [];

      for (const n of d.netze) {
        if (!keys.has(n.key)) continue;
        if (n.art === 'neu') {
          const farbe = COLORS[state.vlans.length % COLORS.length];
          const vlan = cleanVlan({ ...n.unifi, color: farbe });
          state.vlans.push(vlan);
          angewendet.push(`Netz ${vlan.cidr} angelegt`);
        } else if (n.art === 'abweichend') {
          const i = state.vlans.findIndex((v) => v.id === n.id);
          if (i === -1) continue;
          const patch = {};
          for (const a of n.abweichungen) patch[a.feld] = a.unifi;
          state.vlans[i] = cleanVlan({ ...state.vlans[i], ...patch }, state.vlans[i]);
          angewendet.push(`Netz ${state.vlans[i].cidr} aktualisiert`);
        }
      }

      const domain = DEFAULT_DOMAIN;
      const uebersprungen = [];
      const alsHost = (vlanId, u, kindWert) => {
        const hostname = u.name || u.hostname || '';
        return cleanHost({
          vlanId, ip: u.ip, hostname, mac: u.mac || '',
          fqdn: u.dns || (hostname ? `${hostname}.${domain}` : ''),
          kind: kindWert, role: '', notes: '',
        });
      };

      for (const g of d.geraete) {
        if (!keys.has(g.key)) continue;
        if (g.art === 'neu') {
          if (belegt(g.vlanId, g.unifi.ip)) { uebersprungen.push(g.unifi.ip); continue; }
          const host = alsHost(g.vlanId, g.unifi, g.unifi.kind);
          host.role = g.unifi.model || '';
          state.hosts.push(host);
          angewendet.push(`Gerät ${g.unifi.ip} angelegt`);
        } else if (g.art === 'abweichend') {
          const i = state.hosts.findIndex((x) => x.id === g.id);
          if (i === -1) continue;
          const patch = {};
          for (const a of g.abweichungen) patch[a.feld] = a.unifi;
          state.hosts[i] = cleanHost({ ...state.hosts[i], ...patch }, state.hosts[i]);
          angewendet.push(`Gerät ${state.hosts[i].ip} aktualisiert`);
        }
      }

      for (const h of d.hosts) {
        if (!keys.has(h.key)) continue;
        if (h.art === 'neu') {
          if (belegt(h.vlanId, h.unifi.ip)) { uebersprungen.push(h.unifi.ip); continue; }
          // A fixed reservation in the controller is «reserviert». If a device other than the
          // reserved one sits at the address, nothing is known about its kind.
          state.hosts.push(alsHost(h.vlanId, h.unifi, h.veraltet ? 'statisch' : 'reserviert'));
          angewendet.push(`Host ${h.unifi.ip} angelegt`);
        } else if (h.art === 'abweichend') {
          const i = state.hosts.findIndex((x) => x.id === h.id);
          if (i === -1 || !h.abweichungen.length) continue;
          const patch = {};
          for (const a of h.abweichungen) patch[a.feld] = a.unifi;
          state.hosts[i] = cleanHost({ ...state.hosts[i], ...patch }, state.hosts[i]);
          angewendet.push(`Host ${state.hosts[i].ip} aktualisiert`);
        }
      }

      for (const l of d.undokumentiert) {
        if (!keys.has(l.key)) continue;
        if (belegt(l.vlanId, l.ip)) { uebersprungen.push(l.ip); continue; }
        state.hosts.push(alsHost(l.vlanId, l, 'dhcp'));
        angewendet.push(`Host ${l.ip} aus Live-Bestand übernommen`);
      }

      const weg = new Set(d.offline.kandidaten.filter((k) => keys.has(k.key)).map((k) => k.id));
      if (weg.size) {
        backupOnce();
        for (const k of d.offline.kandidaten) {
          if (!weg.has(k.id)) continue;
          angewendet.push(`Host ${k.ip} entfernt (seit ${k.tage} Tagen offline)`);
          log(`Offline-Aufräumen von Hand: ${k.ip} ${k.hostname || ''} ${k.mac}, seit ${k.tage} Tagen offline`);
        }
        state.hosts = state.hosts.filter((h) => !weg.has(h.id));
      }

      // Mark newly created networks as «zone from UniFi» right away.
      unifi.zonenSpiegeln(state, data);

      if (!angewendet.length && !uebersprungen.length) {
        throw new Error('Nichts übernommen — der Abgleich hat sich zwischenzeitlich geändert');
      }
      await persist();
      return send(res, 200, { angewendet, uebersprungen });
    }

    return send(res, 404, { error: 'Unbekannter Endpunkt' });
  }

  if (kind === 'settings' && method === 'PATCH') {
    const body = await readBody(req);
    if (!['auto', 'light', 'dark'].includes(body.theme)) throw new Error('Unbekanntes Erscheinungsbild');
    state.settings = { ...state.settings, theme: body.theme };
    await persist();
    return send(res, 200, state.settings);
  }

  if (kind === 'zones') {
    if (method === 'POST') {
      const zone = zones.cleanZone(await readBody(req), null, state.zones);
      state.zones.push(zone);
      await persist();
      log(`Zone «${zone.name}» angelegt`);
      return send(res, 201, zone);
    }
    const zone = state.zones.find((z) => z.id === id);
    if (!zone) return send(res, 404, { error: 'Zone nicht gefunden' });
    if (method === 'PATCH') {
      const neu = zones.cleanZone(await readBody(req), zone, state.zones);
      if (neu.name !== zone.name) zones.umbenennen(state, zone.name, neu.name);
      state.zones[state.zones.indexOf(zone)] = neu;
      await persist();
      return send(res, 200, neu);
    }
    if (method === 'DELETE') {
      if (zone.quelle === 'unifi') {
        return send(res, 409, { error: 'Diese Zone kommt aus UniFi und würde beim nächsten Abgleich wieder angelegt' });
      }
      const frei = zones.entfernen(state, zone);
      await persist();
      log(`Zone «${zone.name}» gelöscht, ${frei} Netze ohne Zone`);
      return send(res, 200, { ok: true, netzeOhneZone: frei });
    }
  }

  if (kind === 'vlans') {
    if (method === 'POST') {
      const vlan = zoneZuordnen(cleanVlan(await readBody(req)));
      state.vlans.push(vlan);
      await persist();
      return send(res, 201, vlan);
    }
    const idx = state.vlans.findIndex((v) => v.id === id);
    if (idx === -1) return send(res, 404, { error: 'VLAN nicht gefunden' });
    if (method === 'PATCH') {
      const vlan = zoneZuordnen(cleanVlan({ ...state.vlans[idx], ...(await readBody(req)) }, state.vlans[idx]));
      state.vlans[idx] = vlan;
      await persist();
      return send(res, 200, vlan);
    }
    if (method === 'DELETE') {
      state.vlans.splice(idx, 1);
      state.hosts = state.hosts.filter((h) => h.vlanId !== id);
      await persist();
      return send(res, 200, { ok: true });
    }
  }

  if (kind === 'hosts') {
    if (method === 'POST') {
      const host = cleanHost(await readBody(req));
      if (belegt(host.vlanId, host.ip, host.id)) throw new Error(`${host.ip} ist in diesem Netz bereits vergeben`);
      state.hosts.push(host);
      await persist();
      return send(res, 201, host);
    }
    const idx = state.hosts.findIndex((h) => h.id === id);
    if (idx === -1) return send(res, 404, { error: 'Host nicht gefunden' });
    if (method === 'PATCH') {
      const host = cleanHost({ ...state.hosts[idx], ...(await readBody(req)) }, state.hosts[idx]);
      if (belegt(host.vlanId, host.ip, host.id)) throw new Error(`${host.ip} ist in diesem Netz bereits vergeben`);
      state.hosts[idx] = host;
      await persist();
      return send(res, 200, host);
    }
    if (method === 'DELETE') {
      state.hosts.splice(idx, 1);
      await persist();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Unbekannter Endpunkt' });
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname === '/login' ? 'login.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Verboten' });
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Nicht gefunden' });
  }
}

const auth = createAuth({ dataDir: DATA_DIR, log, send, readBody });

// Every controller query also mirrors the security zones into the inventory.
// `info.zonen` tells the caller whether that changed anything.
async function unifiLesen(opts, info = {}) {
  const data = await unifi.fetchAll(opts);
  const aenderungen = unifi.zonenSpiegeln(state, data);
  info.zonen = aenderungen.length;
  if (aenderungen.length) {
    await persist();
    log(`Zonen aus UniFi übernommen: ${aenderungen.join(', ')}`);
  }
  return data;
}

// Removes hosts that UniFi hasn't seen for longer than the configured period.
// Only runs automatically when switched on. Aborts if suspiciously many would be affected at
// once — that more likely means something is wrong with the data from the controller.
async function offlineAufraeumen({ vonHand = false } = {}) {
  const einst = unifi.offlineEinstellung(state);
  if (!unifi.isConfigured()) return { entfernt: [], grund: 'UniFi ist nicht eingerichtet' };
  if (!vonHand && !einst.auto) return { entfernt: [], grund: 'automatisches Aufräumen ist aus' };
  const data = await unifiLesen({ refresh: true });
  const { kandidaten, geprueft } = unifi.offlineKandidaten(state, data);
  if (!kandidaten.length) return { entfernt: [] };
  if (kandidaten.length > 3 && kandidaten.length > geprueft / 2) {
    const grund = `${kandidaten.length} von ${geprueft} geprüften Hosts wären betroffen — zu viele auf einmal, nichts entfernt`;
    log(`Offline-Aufräumen abgebrochen: ${grund}`);
    return { entfernt: [], grund };
  }
  backupOnce();
  const weg = new Set(kandidaten.map((k) => k.id));
  state.hosts = state.hosts.filter((h) => !weg.has(h.id));
  await persist();
  for (const k of kandidaten) {
    log(`Offline-Aufräumen${vonHand ? '' : ' (automatisch)'}: ${k.ip} ${k.hostname || ''} ${k.mac} entfernt, seit ${k.tage} Tagen offline`);
  }
  return { entfernt: kandidaten.map(({ ip, hostname, tage }) => ({ ip, hostname, tage })) };
}

const OFFLINE_INTERVALL = 6 * 60 * 60 * 1000;
function offlinePlanen() {
  const lauf = () => offlineAufraeumen().catch((err) => log('Offline-Aufräumen fehlgeschlagen:', err.message));
  setTimeout(lauf, 60 * 1000).unref();
  setInterval(lauf, OFFLINE_INTERVALL).unref();
}

// Reachable without login: only what the login form itself needs.
const PUBLIC = new Set(['/login', '/login.html', '/login.js', '/i18n.js', '/style.css', '/icon.svg', '/logo.svg',
  '/fonts/plex-mono-400.woff2', '/fonts/plex-mono-500.woff2', '/fonts/plex-mono-600.woff2']);

// What the roles may do. Everyone may read; administrators may do everything.
const NUR_ADMIN = [/^\/api\/import$/, /^\/api\/unifi\/(config|test)$/, /^\/api\/unifi\/offline(\/run)?$/];

function verboten(session, method, pathname) {
  if (session.role === 'admin') return '';
  if (NUR_ADMIN.some((re) => re.test(pathname))) return 'Nur für Administratoren';
  if (['GET', 'HEAD'].includes(method)) return '';
  if (pathname === '/api/settings') return ''; // anyone may switch the appearance
  if (session.role === 'bearbeiter') return '';
  return 'Nur Lesezugriff — für Änderungen braucht es die Rolle «Bearbeiten»';
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

const redirect = (res, location) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  // Over HTTPS: browsers should only connect encrypted from now on.
  if (auth.istSicher(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });

    const isApi = url.pathname.startsWith('/api/');
    // Canonical API paths only: «/api/import/» or «/api//import» would otherwise reach the
    // same endpoint while bypassing the permission check.
    if (isApi && url.pathname !== `/${url.pathname.split('/').filter(Boolean).join('/')}`) {
      return send(res, 404, { error: 'Unbekannter Endpunkt' });
    }
    // Writing API calls only with a custom header. A foreign form or page cannot
    // set it — that reliably locks out CSRF, on top of SameSite=Strict on the cookie.
    if (isApi && !['GET', 'HEAD'].includes(req.method) && req.headers['x-ipam-request'] !== '1') {
      return send(res, 403, { error: 'Anfrage abgelehnt' });
    }

    if (url.pathname.startsWith('/api/auth/')) return await auth.handle(req, res, url);

    const session = auth.check(req);
    if (!session) {
      if (isApi) return send(res, 401, { error: 'Anmeldung erforderlich' });
      if (req.method !== 'GET') return send(res, 405, { error: 'Methode nicht erlaubt' });
      if (PUBLIC.has(url.pathname)) return await serveStatic(res, url.pathname);
      return redirect(res, '/login');
    }

    if (url.pathname === '/api/users' || url.pathname.startsWith('/api/users/')) {
      return await auth.handleUsers(req, res, url, session);
    }
    if (isApi) {
      const grund = verboten(session, req.method, url.pathname);
      if (grund) return send(res, 403, { error: grund });
      return await api(req, res, url);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Methode nicht erlaubt' });
    if (url.pathname === '/login' && auth.enabled) return redirect(res, '/');
    return await serveStatic(res, url.pathname);
  } catch (err) {
    log('Fehler:', err.message);
    if (!res.headersSent) send(res, err.status || 400, { error: err.message }, err.status === 413 ? { Connection: 'close' } : {});
  }
});

loadState().then(() => unifi.init(DATA_DIR)).then(() => auth.init()).then(() => {
  backupOnce();
  offlinePlanen();
  server.listen(PORT, HOST, () => {
    log(`l3t-ipam ${APP_VERSION} laeuft auf http://${HOST}:${PORT}`);
    const herkunft = { web: 'aus der Oberfläche', umgebung: 'aus der Compose-Datei' }[unifi.source()];
    log(unifi.isConfigured() ? `UniFi-Anbindung aktiv (${herkunft}): ${unifi.CFG().url}` : 'UniFi-Anbindung nicht eingerichtet');
  });
}).catch((err) => {
  log('Start abgebrochen:', err.message);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await writeChain;
    server.close(() => process.exit(0));
  });
}
