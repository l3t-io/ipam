'use strict';

// Connection to a UniFi controller. Read-only, no external dependencies.
//
// Primary:    official Integration API    /proxy/network/integration/v1  (X-API-KEY)
// Fallback:   classic controller API      /proxy/network/api/s/<site>    (X-API-KEY, else session)
//
// The classic API returns networks and DHCP reservations that the Integration API may not
// expose yet, depending on the firmware version. That is why both routes are tried.

const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const zones = require('./zones');

// Credentials: maintained in the web UI and stored in data/unifi.json.
// The variables from the Compose file only apply as long as nothing is saved there.
// unifi.json is deliberately kept apart from ipam.json so the key never ends up in an export.
let configFile = '';
let stored = null; // { url, key, site, insecure, updatedAt }

const ENV = () => ({
  url: (process.env.IPAM_UNIFI_URL || '').replace(/\/+$/, ''),
  key: process.env.IPAM_UNIFI_KEY || '',
  site: process.env.IPAM_UNIFI_SITE || 'default',
  insecure: process.env.IPAM_UNIFI_INSECURE !== '0',
});

// Account for controllers without the Integration API: only via the environment — and only
// for the controller it is defined for there. Otherwise changing the address in the web UI
// would send the username and password to a foreign server.
const CFG = () => {
  const env = ENV();
  const basis = stored || env;
  const kontoErlaubt = Boolean(env.url) && basis.url === env.url;
  return {
    ...basis,
    pin: stored && merkbar(stored) ? stored.pin || '' : '',
    user: kontoErlaubt ? process.env.IPAM_UNIFI_USER || '' : '',
    pass: kontoErlaubt ? process.env.IPAM_UNIFI_PASS || '' : '',
    ttl: Number(process.env.IPAM_UNIFI_TTL || 30) * 1000,
  };
};

const source = () => (stored ? 'web' : ENV().url ? 'umgebung' : 'keine');

function init(dataDir) {
  configFile = path.join(dataDir, 'unifi.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    stored = cleanConfig(raw, { requireKey: false });
    if (FP_RE.test(raw.pin || '')) { stored.pin = raw.pin; stored.pinAt = raw.pinAt; }
  } catch (err) {
    stored = null;
    if (err.code !== 'ENOENT') console.log(new Date().toISOString(), 'WARNING: unifi.json unreadable / unlesbar:', err.message);
  }
}

// Validates and normalises an input. Throws on invalid values.
function cleanConfig(input, { requireKey = true } = {}) {
  const url = String(input.url || '').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(url); } catch { throw new Error('Adresse ist keine gültige URL, etwa https://10.1.1.1'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Adresse muss mit https:// oder http:// beginnen');
  if (u.username || u.password) throw new Error('Zugangsdaten gehören nicht in die Adresse');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('Nur die Adresse des Controllers angeben, ohne Pfad');
  const key = String(input.key || '').trim();
  if (requireKey && !key) throw new Error('API-Schlüssel fehlt');
  if (key.length > 512 || /\s/.test(key)) throw new Error('API-Schlüssel hat ein ungültiges Format');
  const site = String(input.site || '').trim() || 'default';
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(site)) throw new Error('Site: nur Buchstaben, Ziffern und . _ -');
  return { url: u.origin, key, site, insecure: input.insecure !== false, updatedAt: input.updatedAt || undefined };
}

// Fills in a key left empty from the saved configuration — but only for the same
// controller. Otherwise a changed entry could send the key to a foreign address.
function withKnownKey(input) {
  const cur = CFG();
  const next = cleanConfig({ ...input, key: input.key || '' }, { requireKey: false });
  if (!next.key) {
    if (!cur.key) throw new Error('API-Schlüssel fehlt');
    if (cur.url !== next.url) throw new Error('Bei geänderter Adresse den API-Schlüssel neu eingeben');
    next.key = cur.key;
  }
  return next;
}

async function schreiben(cfg) {
  const tmp = `${configFile}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(tmp, configFile);
}

async function saveConfig(input) {
  const next = { ...withKnownKey(input), updatedAt: new Date().toISOString() };
  // Pin the certificate («trust on first use»): every save takes over the current
  // certificate — this is how a deliberately renewed certificate gets confirmed.
  // If the controller is unreachable right now, it is pinned on the first connection.
  if (merkbar(next)) {
    const fp = await zertifikatLesen(next.url).catch(() => '');
    if (fp) { next.pin = fp; next.pinAt = new Date().toISOString(); }
  }
  await schreiben(next);
  stored = next;
  reset();
  return publicConfig();
}

async function clearConfig() {
  await fsp.rm(configFile, { force: true });
  stored = null;
  reset();
  return publicConfig();
}

// What the web UI may see: everything except the key itself.
function publicConfig() {
  const c = CFG();
  return {
    source: source(),
    url: c.url,
    site: c.site,
    insecure: c.insecure,
    hasKey: Boolean(c.key),
    keyHint: c.key.length >= 12 ? `…${c.key.slice(-4)}` : '',
    updatedAt: stored ? stored.updatedAt : undefined,
    configured: isConfigured(),
    // Pinned certificate (only when CA verification is off)
    zertifikat: c.pin || '',
    zertifikatSeit: c.pin && stored ? stored.pinAt : undefined,
  };
}

const isConfigured = () => {
  const c = CFG();
  return Boolean(c.url && (c.key || (c.user && c.pass)));
};

/* ---------- HTTP ---------- */

const MAX_ANTWORT = 20 * 1024 * 1024; // a hostile controller must not fill up memory

const FP_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
// A fingerprint is only needed when the certificate is not verified against a CA.
const merkbar = (c) => Boolean(c && c.insecure && String(c.url).startsWith('https:'));

// Establishes the TLS connection without sending anything yet.
function tlsVerbinden(u, timeout) {
  return new Promise((resolve, reject) => {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const sock = tls.connect({
      host, port: Number(u.port || 443), rejectUnauthorized: false,
      ...(net.isIP(host) ? {} : { servername: host }),
    }, () => { sock.setTimeout(0); resolve(sock); });
    sock.setTimeout(timeout, () => sock.destroy(new Error('Zeitüberschreitung')));
    sock.once('error', (err) => reject(new Error(`${err.code || 'Netzwerkfehler'}: ${err.message}`)));
  });
}

// SHA-256 fingerprint of the certificate the controller presents.
async function zertifikatLesen(url, timeout = 8000) {
  const sock = await tlsVerbinden(new URL(url), timeout);
  const fp = sock.getPeerCertificate().fingerprint256 || '';
  sock.destroy();
  return fp;
}

const kurz = (fp) => `${fp.slice(0, 23)}…`;

// If a certificate is pinned, connect and compare first — only then do the API key or
// password go over the wire.
async function request(target, opts = {}) {
  const u = new URL(target);
  if (u.protocol !== 'https:' || !opts.pin) return anfrage(u, opts);
  const sock = await tlsVerbinden(u, opts.timeout || 8000);
  const fp = sock.getPeerCertificate().fingerprint256 || '';
  if (fp !== opts.pin) {
    sock.destroy();
    throw new Error(`Zertifikat des Controllers hat sich geändert (jetzt ${kurz(fp)}) — Verbindung abgebrochen. ` +
      'Ist das erwartet, etwa nach einem Update des Controllers, die Anbindung in den Einstellungen erneut speichern.');
  }
  return anfrage(u, { ...opts, socket: sock });
}

function anfrage(u, { method = 'GET', headers = {}, body, insecure, timeout = 8000, socket = null } = {}) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'http:' ? http : https;
    const payload = body === undefined ? null : JSON.stringify(body);

    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      ...(u.protocol === 'https:' ? { rejectUnauthorized: !insecure } : {}),
      ...(socket ? { createConnection: () => socket, agent: false } : {}),
    }, (res) => {
      const chunks = [];
      let groesse = 0;
      res.on('data', (c) => {
        groesse += c.length;
        if (groesse > MAX_ANTWORT) { req.destroy(new Error('Antwort des Controllers zu gross')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });

    req.on('error', (err) => reject(new Error(`${err.code || 'Netzwerkfehler'}: ${err.message}`)));
    req.setTimeout(timeout, () => { req.destroy(new Error('Zeitüberschreitung')); });
    // Plus an upper limit for the whole request: a server trickling out byte by byte
    // would otherwise never trigger the idle timeout.
    const gesamt = setTimeout(() => req.destroy(new Error('Zeitüberschreitung')), timeout * 3);
    req.on('close', () => clearTimeout(gesamt));
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------- Sign-in ---------- */

let session = null; // { cookie, csrf }

async function login(c) {
  const res = await request(`${c.url}/api/auth/login`, {
    method: 'POST',
    body: { username: c.user, password: c.pass, rememberMe: true },
    insecure: c.insecure,
    pin: c.pin,
  });
  if (res.status !== 200) {
    throw new Error(`Anmeldung am Controller fehlgeschlagen (HTTP ${res.status})`);
  }
  const setCookie = [].concat(res.headers['set-cookie'] || []);
  const cookie = setCookie.map((s) => s.split(';')[0]).join('; ');
  session = { cookie, csrf: res.headers['x-csrf-token'] || res.headers['x-updated-csrf-token'] || '' };
  return session;
}

// Fetches a path. First with the key, on 401/403 once more with a session.
async function get(path, c, { allow404 = false } = {}) {
  const attempt = async (headers) => request(`${c.url}${path}`, { headers, insecure: c.insecure, pin: c.pin });

  let res = c.key ? await attempt({ 'X-API-KEY': c.key }) : { status: 401 };

  if ((res.status === 401 || res.status === 403) && c.user && c.pass) {
    if (!session) await login(c);
    res = await attempt({ Cookie: session.cookie, ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}) });
    if (res.status === 401) {
      session = null;
      await login(c);
      res = await attempt({ Cookie: session.cookie, ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}) });
    }
  }

  if (res.status === 404 && allow404) return null;
  if (res.status === 401 || res.status === 403) {
    throw new Error('Zugriff abgelehnt — API-Schlüssel prüfen (HTTP ' + res.status + ')');
  }
  if (res.status >= 400) throw new Error(`HTTP ${res.status} bei ${path}`);
  return res.json;
}

/* ---------- Normalisation ---------- */

const ipToInt = (ip) => {
  const p = String(ip ?? '').trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
};
const intToIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

// UniFi stores the gateway address plus prefix in ip_subnet, e.g. 10.13.37.1/24.
// This splits it into network address and gateway.
function splitSubnet(value) {
  const m = String(value || '').trim().match(/^([\d.]+)\/(\d{1,2})$/);
  if (!m) return { cidr: '', gateway: '' };
  const addr = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (addr === null || prefix > 32) return { cidr: '', gateway: '' };
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (addr & mask) >>> 0;
  return {
    cidr: `${intToIp(net)}/${prefix}`,
    gateway: net === addr ? '' : intToIp(addr),
  };
}

const pick = (obj, ...names) => {
  for (const n of names) {
    if (obj && obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return '';
};

function normalizeNetwork(raw) {
  const subnetRaw = pick(raw, 'ip_subnet', 'ipSubnet', 'subnet', 'cidr');
  const { cidr, gateway } = splitSubnet(subnetRaw);
  if (!cidr) return null;
  return {
    uid: String(pick(raw, 'id', '_id') || ''),
    name: String(pick(raw, 'name', 'displayName') || 'ohne Namen'),
    vid: Number(pick(raw, 'vlan', 'vlanId', 'vlan_id') || 0),
    cidr,
    gateway: gateway || String(pick(raw, 'gateway_ip', 'gatewayIp') || ''),
    dhcpFrom: String(pick(raw, 'dhcpd_start', 'dhcpStart') || ''),
    dhcpTo: String(pick(raw, 'dhcpd_stop', 'dhcpStop') || ''),
    purpose: String(pick(raw, 'purpose') || ''),
    zone: '',
  };
}

function normalizeDevice(raw) {
  const ip = String(pick(raw, 'ip', 'ipAddress') || '');
  const netzKonf = raw.config_network || raw.configNetwork || {};
  return {
    ip,
    mac: String(pick(raw, 'mac', 'macAddress') || '').toLowerCase(),
    name: String(pick(raw, 'name') || ''),
    model: String(pick(raw, 'model', 'shortname', 'modelName') || ''),
    // Infrastructure is documented as static unless the controller says otherwise.
    kind: String(pick(netzKonf, 'type') || '').toLowerCase() === 'dhcp' ? 'dhcp' : 'statisch',
  };
}

// A client only has a fixed reservation if the switch is set. UniFi often keeps the
// fixed_ip field after the fixed IP was turned off — on its own it used to turn every
// old device that went offline into a «reservation».
function normalizeClient(raw) {
  const fixed = raw.use_fixedip === true || raw.useFixedIp === true;
  const ip = String((fixed ? pick(raw, 'fixed_ip', 'fixedIp') : '') || pick(raw, 'ip', 'ipAddress', 'last_ip') || '');
  const seen = Number(pick(raw, 'last_seen', 'lastSeen') || 0);
  return {
    ip,
    mac: normMac(pick(raw, 'mac', 'macAddress')),
    name: String(pick(raw, 'name') || ''),
    hostname: String(pick(raw, 'hostname', 'displayName') || ''),
    dns: String(pick(raw, 'local_dns_record', 'localDnsRecord') || ''),
    fixed,
    // UniFi counts in seconds
    lastSeen: seen ? (seen < 1e12 ? seen * 1000 : seen) : 0,
  };
}

const normMac = (m) => String(m || '').trim().toLowerCase().replace(/-/g, ':');

/* ---------- Security zones ---------- */

// Zone-based firewall from Network 9 on: every zone knows the IDs of its networks.
// Read via the Integration API, otherwise via the older controller API. The two APIs
// assign different network IDs — if none matches, the subnet is used to assign them.
async function zonenZuordnen(c, siteId, siteName, networks) {
  let zonen = null;
  let quelle = '';
  if (siteId) {
    const r = await get(`/proxy/network/integration/v1/sites/${siteId}/firewall/zones?limit=200`, c, { allow404: true }).catch(() => null);
    const list = r?.data || (Array.isArray(r) ? r : null);
    if (Array.isArray(list) && list.length) { zonen = list; quelle = 'Zonen über Integration API'; }
  }
  if (!zonen) {
    const r = await get(`/proxy/network/v2/api/site/${siteName}/firewall/zone`, c, { allow404: true }).catch(() => null);
    const list = Array.isArray(r) ? r : r?.data;
    if (Array.isArray(list) && list.length) { zonen = list; quelle = 'Zonen über klassische API'; }
  }
  if (!zonen) {
    return { quelle: '', info: 'Keine Sicherheitszonen gelesen — zonenbasierte Firewall nicht aktiv oder vom Controller nicht ausgegeben' };
  }

  const zoneVon = new Map();
  for (const z of zonen) {
    const name = String(pick(z, 'name') || '').trim().slice(0, 40);
    if (!name) continue;
    for (const id of [].concat(z.networkIds || z.network_ids || [])) zoneVon.set(String(id), name);
  }

  // Network IDs differ between the APIs. So record from both lists which network is behind
  // an ID — with subnet, VLAN ID and name, whatever is available.
  const steckbrief = new Map();
  const merken = (raw) => {
    const id = String(raw.id || raw._id || '');
    if (!id) return;
    const nn = normalizeNetwork(raw);
    steckbrief.set(id, {
      cidr: nn ? nn.cidr : '',
      vid: Number(pick(raw, 'vlan', 'vlanId', 'vlan_id') || 0),
      name: String(pick(raw, 'name', 'displayName') || '').toLowerCase(),
    });
  };
  if (siteId) {
    const r = await get(`/proxy/network/integration/v1/sites/${siteId}/networks?limit=200`, c, { allow404: true }).catch(() => null);
    for (const raw of r?.data || (Array.isArray(r) ? r : [])) merken(raw);
  }
  const klassisch = await get(`/proxy/network/api/s/${siteName}/rest/networkconf`, c, { allow404: true }).catch(() => null);
  for (const raw of klassisch?.data || []) merken(raw);

  const passt = (n, sb) => (sb.cidr && sb.cidr === n.cidr) || (sb.vid > 0 && sb.vid === n.vid) ||
    (sb.name && sb.name === n.name.toLowerCase());
  for (const n of networks) {
    if (n.uid && zoneVon.has(n.uid)) { n.zone = zoneVon.get(n.uid); continue; }
    for (const [id, zone] of zoneVon) {
      const sb = steckbrief.get(id);
      if (sb && passt(n, sb)) { n.zone = zone; break; }
    }
  }

  const ohne = networks.filter((n) => !n.zone).map((n) => n.name);
  const info = `${zonen.length} Zonen gelesen, ${networks.length - ohne.length} von ${networks.length} Netzen zugeordnet` +
    (ohne.length ? ` — ohne Zone: ${ohne.join(', ')}` : '');
  return { quelle, info, namen: zonen.map((z) => String(pick(z, 'name') || '').trim().slice(0, 40)).filter(Boolean) };
}

// Some devices pass other devices' traffic through — e.g. a Sonos soundbar that the sub
// and rear speakers connect through. UniFi then sees their addresses behind the soundbar's
// MAC. A MAC on several addresses is therefore treated as a bridge: for each of these
// addresses, the actual device from the client list is used where available.
function brueckenAufloesen(live, clients) {
  const adressen = new Map();
  for (const l of live) if (l.mac) adressen.set(l.mac, (adressen.get(l.mac) || 0) + 1);
  return live.map((l) => {
    if (!l.mac || adressen.get(l.mac) < 2) return l;
    const echt = clients.filter((c) => c.ip === l.ip && c.mac && c.mac !== l.mac)
      .sort((x, y) => y.lastSeen - x.lastSeen)[0];
    if (!echt) return { ...l, bruecke: true };
    return { ...l, mac: echt.mac, name: echt.name || l.name, hostname: echt.hostname || l.hostname, ueberBruecke: l.mac };
  });
}

/* ---------- Fetching ---------- */

let cache = { at: 0, data: null };

function reset() {
  cache = { at: 0, data: null };
  session = null;
}

// With `config`, a not yet saved configuration is tried out —
// without the cache and without touching the current session.
async function fetchAll({ refresh = false, config = null } = {}) {
  const probe = Boolean(config);
  const c = probe
    ? { ...CFG(), ...config, user: '', pass: '', pin: config.url === CFG().url && merkbar(config) ? CFG().pin : '' }
    : CFG();
  if (!probe && merkbar(stored) && !stored.pin) {
    // The controller was unreachable when saving: pin it now.
    const fp = await zertifikatLesen(stored.url).catch(() => '');
    if (fp) {
      stored = { ...stored, pin: fp, pinAt: new Date().toISOString() };
      await schreiben(stored).catch(() => {});
      c.pin = fp;
    }
  }
  if (!probe && !isConfigured()) throw new Error('Keine UniFi-Zugangsdaten hinterlegt');
  if (!probe && !refresh && cache.data && Date.now() - cache.at < c.ttl) return cache.data;

  const quellen = [];
  const warnungen = [];
  const fehler = [];
  const merken = (e) => { fehler.push(e); return null; };

  // Application info and site resolution
  let version = '';
  let siteId = '';
  let siteName = c.site;

  const info = await get('/proxy/network/integration/v1/info', c, { allow404: true }).catch(merken);
  if (info) version = String(pick(info, 'applicationVersion', 'version') || '');

  const sites = await get('/proxy/network/integration/v1/sites', c, { allow404: true }).catch(merken);
  const siteList = sites?.data || sites || [];
  if (Array.isArray(siteList) && siteList.length) {
    const wanted = String(c.site).toLowerCase();
    const hit = siteList.find((s) =>
      String(s.id).toLowerCase() === wanted ||
      String(pick(s, 'internalReference', 'name')).toLowerCase() === wanted) || siteList[0];
    siteId = String(hit.id || '');
    siteName = String(pick(hit, 'internalReference', 'name') || c.site);
    quellen.push('Integration API');
  }

  // Networks: the classic API reliably has ip_subnet, the Integration API depending on version
  let networks = [];
  if (siteId) {
    const r = await get(`/proxy/network/integration/v1/sites/${siteId}/networks`, c, { allow404: true }).catch(merken);
    const list = r?.data || (Array.isArray(r) ? r : []);
    networks = list.map(normalizeNetwork).filter(Boolean);
    if (networks.length) quellen.push('Netze über Integration API');
  }
  if (!networks.length) {
    const r = await get(`/proxy/network/api/s/${siteName}/rest/networkconf`, c, { allow404: true }).catch((e) => {
      warnungen.push(`Netze nicht lesbar: ${e.message}`);
      return merken(e);
    });
    const list = r?.data || [];
    networks = list
      .filter((n) => n.enabled !== false && pick(n, 'purpose') !== 'wan')
      .map(normalizeNetwork)
      .filter(Boolean);
    if (networks.length) quellen.push('Netze über klassische API');
  }

  let zonenInfo = '';
  let zonenNamen = null; // all zone names the controller knows, null if none could be read
  if (networks.length) {
    const z = await zonenZuordnen(c, siteId, siteName, networks)
      .catch((e) => ({ quelle: '', info: `Zonen nicht lesbar: ${e.message}` }));
    if (z.quelle) quellen.push(z.quelle);
    zonenInfo = z.info;
    if (z.quelle) zonenNamen = z.namen;
  }

  // Fixed reservations: known clients from the classic API
  let reservations = [];
  let clients = []; // all known clients, including offline ones — for «last seen»
  {
    const r = await get(`/proxy/network/api/s/${siteName}/rest/user`, c, { allow404: true }).catch((e) => {
      warnungen.push(`Reservierungen nicht lesbar: ${e.message}`);
      return merken(e);
    });
    clients = (r?.data || []).map(normalizeClient);
    reservations = clients.filter((x) => x.fixed && x.ip);
    if (reservations.length) quellen.push('Reservierungen über klassische API');
  }

  // UniFi devices: gateway, switches, access points
  let devices = [];
  if (siteId) {
    const seen = [];
    for (let offset = 0; offset < 1000; offset += 200) {
      const r = await get(`/proxy/network/integration/v1/sites/${siteId}/devices?offset=${offset}&limit=200`, c, { allow404: true })
        .catch(merken);
      const list = r?.data || (Array.isArray(r) ? r : []);
      seen.push(...list);
      if (list.length < 200) break;
    }
    devices = seen.map(normalizeDevice).filter((x) => x.ip);
    if (devices.length) quellen.push('Geräte über Integration API');
  }
  if (!devices.length) {
    const r = await get(`/proxy/network/api/s/${siteName}/stat/device`, c, { allow404: true }).catch((e) => {
      warnungen.push(`Geräte nicht lesbar: ${e.message}`);
      return merken(e);
    });
    devices = (r?.data || []).map(normalizeDevice).filter((x) => x.ip);
    if (devices.length) quellen.push('Geräte über klassische API');
  }

  // Currently connected clients
  let live = [];
  if (siteId) {
    const seen = [];
    for (let offset = 0; offset < 2000; offset += 200) {
      const r = await get(`/proxy/network/integration/v1/sites/${siteId}/clients?offset=${offset}&limit=200`, c, { allow404: true })
        .catch(merken);
      const list = r?.data || (Array.isArray(r) ? r : []);
      seen.push(...list);
      if (list.length < 200) break;
    }
    live = seen.map(normalizeClient).filter((x) => x.ip);
    if (live.length) quellen.push('Clients über Integration API');
  }
  if (!live.length) {
    const r = await get(`/proxy/network/api/s/${siteName}/stat/sta`, c, { allow404: true }).catch((e) => {
      warnungen.push(`Clients nicht lesbar: ${e.message}`);
      return merken(e);
    });
    live = (r?.data || []).map(normalizeClient).filter((x) => x.ip);
    if (live.length) quellen.push('Clients über klassische API');
  }

  live = brueckenAufloesen(live, clients);

  // If nothing came through at all, that is an error, not an empty controller.
  if (!networks.length && !reservations.length && !live.length && !devices.length && fehler.length) {
    const abgelehnt = fehler.find((e) => /abgelehnt|401|403/.test(e.message));
    throw new Error(abgelehnt ? abgelehnt.message : fehler[0].message);
  }

  const data = {
    ok: true,
    controller: c.url,
    version,
    site: siteName,
    quellen,
    warnungen,
    zonenInfo,
    zonenNamen,
    networks,
    reservations,
    clients,
    devices,
    live,
    at: new Date().toISOString(),
  };
  if (!probe) cache = { at: Date.now(), data };
  return data;
}

const FRISCH = 24 * 60 * 60 * 1000;

/* ---------- Mirroring zones ---------- */

// Matches a documented network to the network in the controller: by subnet first,
// otherwise by VLAN ID.
const netzImController = (unifi, v) =>
  unifi.networks.find((u) => u.cidr === v.cidr) ||
  unifi.networks.find((u) => u.vid > 0 && Number(v.vid) === u.vid);

// UniFi owns the zone: for networks the controller knows, it is taken over and marked
// as «from UniFi». If the controller returns no zones at all, everything stays as it is.
// Returns the changes; the caller saves.
function zonenSpiegeln(state, unifi) {
  if (!(unifi.quellen || []).some((q) => q.startsWith('Zonen'))) return [];
  const aenderungen = [];
  // Zones as records: every zone the controller knows exists here as well (system zones only
  // when a network uses them). Zones UniFi no longer has become manual ones.
  const imController = new Set();
  const benutzt = new Set(unifi.networks.map((u) => String(u.zone || '').toLowerCase()).filter(Boolean));
  for (const name of unifi.zonenNamen || []) {
    imController.add(name.toLowerCase());
    if (zones.SYSTEM_ZONES.has(name.toLowerCase()) && !benutzt.has(name.toLowerCase())) continue;
    const { zone, neu } = zones.sicherstellen(state, name, 'unifi');
    if (neu) aenderungen.push(`Zone «${zone.name}» angelegt`);
    else if (zone.quelle !== 'unifi') { zone.quelle = 'unifi'; aenderungen.push(`Zone «${zone.name}» kommt jetzt aus UniFi`); }
  }
  for (const z of state.zones || []) {
    if (z.quelle === 'unifi' && unifi.zonenNamen && !imController.has(z.name.toLowerCase())) {
      z.quelle = 'manuell';
      aenderungen.push(`Zone «${z.name}» nicht mehr in UniFi`);
    }
  }
  for (const v of state.vlans) {
    const u = netzImController(unifi, v);
    const zone = u && u.zone;
    if (zone) {
      const name = zones.sicherstellen(state, zone, 'unifi').zone.name;
      if (v.zone !== name) aenderungen.push(`${v.cidr}: ${v.zone || '—'} → ${name}`);
      v.zone = name;
      v.zoneAusUnifi = true;
    } else if (v.zoneAusUnifi) {
      // No longer in the controller or without a zone: the field stays but is editable again.
      v.zoneAusUnifi = false;
      aenderungen.push(`${v.cidr}: Zone nicht mehr aus UniFi`);
    }
  }
  return aenderungen;
}

/* ---------- Offline devices ---------- */

const OFFLINE_VORGABE = { auto: false, tage: 30, alleTypen: false };
const offlineEinstellung = (state) => ({ ...OFFLINE_VORGABE, ...(state.settings?.offline || {}) });

// Documented hosts that UniFi has not seen for at least `tage` days.
// Deliberately cautious: hosts without a MAC, unknown to UniFi, UniFi devices, currently online
// or marked «sporadic» are never suggested. Without `alleTypen`, DHCP entries only.
function offlineKandidaten(state, unifi, einstellung = offlineEinstellung(state), jetzt = Date.now()) {
  const online = new Set(unifi.live.map((l) => l.mac).filter(Boolean));
  const infra = new Set(unifi.devices.map((d) => d.mac).filter(Boolean));
  const bekannt = new Map();
  for (const c of unifi.clients || []) {
    if (c.mac && c.lastSeen > (bekannt.get(c.mac) || 0)) bekannt.set(c.mac, c.lastSeen);
  }
  const vlanName = new Map(state.vlans.map((v) => [v.id, v.name]));
  const kandidaten = [];
  let ohneDaten = 0;
  let geprueft = 0;
  for (const h of state.hosts) {
    if (h.sporadisch) continue;
    if (!einstellung.alleTypen && h.kind !== 'dhcp') continue;
    const mac = normMac(h.mac);
    if (!mac || infra.has(mac)) continue;
    geprueft++;
    if (online.has(mac)) continue;
    const zuletzt = bekannt.get(mac);
    if (!zuletzt) { ohneDaten++; continue; }
    const tage = Math.floor((jetzt - zuletzt) / 86400000);
    if (tage >= einstellung.tage) {
      kandidaten.push({
        key: `off:${h.id}`, id: h.id, ip: h.ip, hostname: h.hostname, mac, kind: h.kind,
        vlanName: vlanName.get(h.vlanId) || '', lastSeen: new Date(zuletzt).toISOString(), tage,
      });
    }
  }
  kandidaten.sort((a, b) => b.tage - a.tage);
  return { tage: einstellung.tage, alleTypen: einstellung.alleTypen, kandidaten, ohneDaten, geprueft };
}

// Last seen per MAC, for display in the host form.
function zuletztGesehen(unifi) {
  const out = {};
  for (const c of unifi.clients || []) if (c.mac && c.lastSeen > (out[c.mac] || 0)) out[c.mac] = c.lastSeen;
  for (const l of unifi.live) if (l.mac) out[l.mac] = Date.now();
  return out;
}

/* ---------- Sync ---------- */

function parseCidr(cidr) {
  const m = String(cidr || '').match(/^([\d.]+)\/(\d{1,2})$/);
  if (!m) return null;
  const base = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (base === null || prefix > 32) return null;
  const size = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (base & mask) >>> 0;
  return { net, bcast: net + size - 1 };
}

function diff(state, unifi) {
  const netzDiff = [];
  const felder = [['cidr', 'Subnetz'], ['gateway', 'Gateway'], ['dhcpFrom', 'DHCP von'], ['dhcpTo', 'DHCP bis'], ['vid', 'VLAN-ID'], ['zone', 'Zone']];

  for (const u of unifi.networks) {
    const eigen = state.vlans.find((v) => v.cidr === u.cidr) ||
      state.vlans.find((v) => Number(v.vid) === u.vid && u.vid > 0);
    if (!eigen) {
      netzDiff.push({ key: `net:new:${u.cidr}`, art: 'neu', unifi: u });
      continue;
    }
    const abweichungen = felder
      .filter(([f]) => u[f] && String(eigen[f] ?? '') !== String(u[f]))
      .map(([f, label]) => ({ feld: f, label, ipam: String(eigen[f] ?? ''), unifi: String(u[f]) }));
    if (abweichungen.length) {
      netzDiff.push({ key: `net:diff:${eigen.id}`, art: 'abweichend', id: eigen.id, name: eigen.name, unifi: u, abweichungen });
    }
  }
  for (const v of state.vlans) {
    if (!unifi.networks.some((u) => u.cidr === v.cidr || (u.vid > 0 && Number(v.vid) === u.vid))) {
      netzDiff.push({ key: `net:only:${v.id}`, art: 'nur-ipam', id: v.id, name: v.name, cidr: v.cidr, vid: v.vid });
    }
  }

  // Assign an address to a documented network
  const zuNetz = (ip) => {
    const n = ipToInt(ip);
    if (n === null) return null;
    for (const v of state.vlans) {
      const r = parseCidr(v.cidr);
      if (r && n >= r.net && n <= r.bcast) return v;
    }
    return null;
  };

  // Precedence: device before reservation before live find. An address appears only once.
  const vorgeschlagen = new Set();

  const geraeteDiff = [];
  for (const g of unifi.devices) {
    const vlan = zuNetz(g.ip);
    if (!vlan) continue;
    const eigen = state.hosts.find((h) => h.vlanId === vlan.id && h.ip === g.ip);
    if (!eigen) {
      geraeteDiff.push({ key: `dev:new:${vlan.id}:${g.ip}`, art: 'neu', vlanId: vlan.id, vlanName: vlan.name, unifi: g });
      vorgeschlagen.add(`${vlan.id}|${g.ip}`);
      continue;
    }
    const abweichungen = [];
    if (g.mac && eigen.mac.toLowerCase() !== g.mac) {
      abweichungen.push({ feld: 'mac', label: 'MAC', ipam: eigen.mac, unifi: g.mac });
    }
    if (g.name && !eigen.hostname) abweichungen.push({ feld: 'hostname', label: 'Hostname', ipam: '', unifi: g.name });
    if (g.model && !eigen.role) abweichungen.push({ feld: 'role', label: 'Rolle', ipam: '', unifi: g.model });
    if (abweichungen.length) {
      geraeteDiff.push({ key: `dev:diff:${eigen.id}`, art: 'abweichend', id: eigen.id, vlanId: vlan.id, ip: g.ip, unifi: g, abweichungen });
    }
    vorgeschlagen.add(`${vlan.id}|${g.ip}`);
  }

  // A reservation can be stale: the controller still lists it for an old device while
  // another one has long been online at the same address (e.g. with a statically
  // configured IP). What actually responds is then what counts.
  const liveNachIp = new Map(unifi.live.map((l) => [l.ip, l]));
  const gesehen = new Map();
  for (const c of unifi.clients || []) if (c.mac && c.lastSeen > (gesehen.get(c.mac) || 0)) gesehen.set(c.mac, c.lastSeen);
  const zuletzt = (mac) => (gesehen.get(mac) ? new Date(gesehen.get(mac)).toISOString() : '');
  // If the reserved device was seen recently, the reservation is in use —
  // regardless of what the live data currently shows at that address.
  const kuerzlich = (mac) => Date.now() - (gesehen.get(mac) || 0) < FRISCH;
  const veraltetVon = (r, aktuell) => ({ name: r.name || r.hostname, mac: r.mac, lastSeen: zuletzt(r.mac), aktuell });

  const mitLive = (r) => {
    const jetzt = liveNachIp.get(r.ip);
    if (!jetzt) return { quelle: r };
    if (jetzt.mac && r.mac && jetzt.mac !== r.mac && (jetzt.bruecke || kuerzlich(r.mac))) return { quelle: r };
    if (jetzt.mac && r.mac && jetzt.mac !== r.mac) {
      return {
        quelle: { ...jetzt, fixed: false },
        veraltet: veraltetVon(r, { mac: jetzt.mac, name: jetzt.name || jetzt.hostname, online: true }),
      };
    }
    // Same device: the current name from the live data takes precedence.
    return { quelle: { ...r, name: jetzt.name || r.name, hostname: jetzt.hostname || r.hostname, dns: r.dns || jetzt.dns } };
  };

  const hostDiff = [];
  const pruefen = []; // to be resolved in the controller, nothing to apply here
  const ignoriert = new Set((state.ignoriert || []).map((i) => i.key));
  let ausgeblendet = 0;
  for (const res of unifi.reservations) {
    const vlan = zuNetz(res.ip);
    if (!vlan) continue; // network is not documented, already listed above
    if (vorgeschlagen.has(`${vlan.id}|${res.ip}`)) continue; // already listed as a device
    const ergebnis = mitLive(res);
    const r = ergebnis.quelle;
    let { veraltet } = ergebnis;
    const eigen = state.hosts.find((h) => h.vlanId === vlan.id && h.ip === r.ip);
    // If the documented device is not online right now, «last seen» decides:
    // if it was seen later than the reserved one, the reservation is stale —
    // not the documentation. Otherwise the sync would write the old MAC back.
    const eigenMac = eigen ? normMac(eigen.mac) : '';
    if (eigen && !veraltet && eigenMac && r.mac && eigenMac !== r.mac && !kuerzlich(r.mac) &&
        (gesehen.get(eigenMac) || 0) > (gesehen.get(r.mac) || 0)) {
      veraltet = veraltetVon(r, { mac: eigenMac, name: eigen.hostname, online: false });
    }
    // Deliberately hidden notices: tied to the address and MAC of the reservation.
    if (veraltet && ignoriert.has(`chk:${r.ip}|${veraltet.mac}`)) {
      ausgeblendet++;
      veraltet = undefined;
    }
    if (eigen && veraltet) {
      pruefen.push({
        key: `chk:${r.ip}|${veraltet.mac}`, ip: r.ip, vlanName: vlan.name,
        eigen: { hostname: eigen.hostname, mac: eigenMac }, veraltet,
      });
    }
    if (!eigen) {
      hostDiff.push({ key: `host:new:${vlan.id}:${r.ip}`, art: 'neu', vlanId: vlan.id, vlanName: vlan.name, unifi: r, veraltet });
      vorgeschlagen.add(`${vlan.id}|${r.ip}`);
      continue;
    }
    const abweichungen = [];
    // With a stale reservation, the documented MAC is correct — suggest nothing.
    if (!veraltet && r.mac && eigen.mac && eigenMac !== r.mac) {
      abweichungen.push({ feld: 'mac', label: 'MAC', ipam: eigen.mac, unifi: r.mac });
    }
    if (r.mac && !eigen.mac) abweichungen.push({ feld: 'mac', label: 'MAC', ipam: '', unifi: r.mac });
    // A reservation in the controller means «reserved» here — provided it belongs to
    // exactly this device.
    if (!veraltet && r.fixed && eigen.kind !== 'reserviert' && (!eigenMac || eigenMac === r.mac)) {
      abweichungen.push({ feld: 'kind', label: 'Typ', ipam: eigen.kind || 'statisch', unifi: 'reserviert' });
    }
    const uName = r.name || r.hostname;
    if (uName && !eigen.hostname) abweichungen.push({ feld: 'hostname', label: 'Hostname', ipam: '', unifi: uName });
    if (abweichungen.length) {
      hostDiff.push({ key: `host:diff:${eigen.id}`, art: 'abweichend', id: eigen.id, vlanId: vlan.id, ip: r.ip, unifi: r, abweichungen });
    }
    vorgeschlagen.add(`${vlan.id}|${r.ip}`);
  }

  // Seen live, but not recorded anywhere.
  // Addresses already offered above as a reservation to apply are left out here —
  // otherwise applying both lists would create the same host twice.
  const undokumentiert = [];
  for (const l of unifi.live) {
    const vlan = zuNetz(l.ip);
    if (!vlan) continue;
    if (state.hosts.some((h) => h.vlanId === vlan.id && h.ip === l.ip)) continue;
    if (vorgeschlagen.has(`${vlan.id}|${l.ip}`)) continue;
    if (vlan.gateway === l.ip) continue;
    undokumentiert.push({ key: `live:${vlan.id}:${l.ip}`, vlanId: vlan.id, vlanName: vlan.name, ...l });
  }

  return {
    netze: netzDiff,
    geraete: geraeteDiff,
    hosts: hostDiff,
    undokumentiert,
    offline: offlineKandidaten(state, unifi),
    pruefen,
    ausgeblendet,
    live: unifi.live.map((l) => ({ ip: l.ip, mac: l.mac, name: l.name || l.hostname })),
    meta: {
      controller: unifi.controller,
      version: unifi.version,
      site: unifi.site,
      quellen: unifi.quellen,
      warnungen: unifi.warnungen,
      zonenInfo: unifi.zonenInfo || '',
      at: unifi.at,
    },
  };
}

module.exports = {
  isConfigured, fetchAll, diff, CFG, splitSubnet, normalizeNetwork, normalizeClient, normalizeDevice,
  init, source, saveConfig, clearConfig, publicConfig, withKnownKey, zertifikatLesen,
  offlineKandidaten, offlineEinstellung, zuletztGesehen, normMac, OFFLINE_VORGABE, zonenSpiegeln,
  brueckenAufloesen,
};
