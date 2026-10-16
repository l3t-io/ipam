'use strict';

// Login and user management for l3t-ipam — without external dependencies.
//
// Accounts:   data/auth.json, several users with a role, passwords as scrypt hashes.
//             Optionally also a fixed administrator account via IPAM_USER/IPAM_PASS.
// Roles:      admin (everything), bearbeiter (maintain inventory), leser (view only).
// Sessions:   random token in the cookie (HttpOnly, SameSite=Strict), stored on the server
//             only as a SHA-256 hash in data/sessions.json. Role and account are looked up
//             afresh on every request — a change takes effect immediately.
// Protection: per-address lockout after repeated failures, global throttle,
//             delay on every failure, setup code only in the container log.

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const COOKIE = 'l3t_ipam';
const MIN_PASS = 12;
const MAX_PASS = 256;
const USER_RE = /^[A-Za-z0-9._@-]{1,64}$/;
const ROLES = ['admin', 'bearbeiter', 'leser'];
const ENV_ID = 'umgebung';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

const HOUR = 60 * 60 * 1000;
const IDLE = 12 * HOUR;                 // without «stay signed in»
const ABSOLUTE = 7 * 24 * HOUR;         // without «stay signed in»
const REMEMBER = 30 * 24 * HOUR;        // with «stay signed in»
const MAX_SESSIONS = 1000;              // in total
const MAX_SESSIONS_PRO_KONTO = 20;      // older sessions of the same account are dropped

const WINDOW = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 10;            // then locked for 15 minutes
const MAX_FAILS_GLOBAL = 100;           // per hour across all addresses: then only throttle
const MAX_FAILS_PRO_KONTO = 10;         // per username in 15 minutes: then only throttle
const BREMSE = 3000;                    // extra ms once either of these two limits is reached
const FAIL_DELAY = 750;                 // ms, slows down automated guessing
const MAX_PARALLEL_HASHES = 4;

function scryptAsync(pass, salt, opts) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(pass, salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

async function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pass, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(pass, stored) {
  const [algo, N, r, p, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(pass, Buffer.from(salt, 'base64'), {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Tag of the current password: if it changes, all old sessions become invalid.
const generation = (hash) => sha256(hash).toString('hex').slice(0, 16);
const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
// Strip control characters from user input before it goes into the log.
const fuersLog = (s) => String(s).slice(0, 64).replace(/[\u0000-\u001f\u007f]/g, '?');

// Match an IPv4 address against an address or a network (CIDR).
const ipZahl = (ip) => {
  const p = String(ip).split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((n, x) => n * 256 + Number(x), 0);
};
function passtIp(ip, eintrag) {
  const adresse = String(ip || '').replace(/^::ffff:/, '');
  if (!eintrag.includes('/')) return adresse === eintrag;
  const [netz, bits] = eintrag.split('/');
  const a = ipZahl(adresse);
  const n = ipZahl(netz);
  const b = Number(bits);
  if (a === null || n === null || !(b >= 0 && b <= 32)) return false;
  const maske = b === 0 ? 0 : (0xffffffff << (32 - b)) >>> 0;
  return ((a & maske) >>> 0) === ((n & maske) >>> 0);
}

// Easy to read, without confusable characters such as 0/O or 1/I/L.
function setupCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  // randomInt instead of byte % length: every character equally likely (no modulo bias).
  const s = Array.from({ length: 12 }, () => abc[crypto.randomInt(abc.length)]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function createAuth({ dataDir, env = process.env, log = console.log, send, readBody }) {
  const AUTH_FILE = path.join(dataDir, 'auth.json');
  const SESSION_FILE = path.join(dataDir, 'sessions.json');
  const disabled = ['off', '0', 'false', 'aus'].includes(String(env.IPAM_AUTH || '').toLowerCase());
  // IPAM_TRUST_PROXY: «1» trusts proxy headers from anywhere (only sensible if the port is
  // not directly reachable); a list such as «172.17.0.1, 10.0.0.0/8» only from there.
  const trustRoh = String(env.IPAM_TRUST_PROXY || '').trim().toLowerCase();
  const trustAlle = ['1', 'true', 'on', 'ja'].includes(trustRoh);
  const trustListe = trustAlle || ['', '0', 'false', 'off', 'nein'].includes(trustRoh)
    ? [] : trustRoh.split(',').map((s) => s.trim()).filter(Boolean);
  const vomProxy = (req) => trustAlle || trustListe.some((e) => passtIp(req.socket.remoteAddress, e));
  const forceSecure = env.IPAM_COOKIE_SECURE === '1';
  const failDelay = env.IPAM_AUTH_FAIL_DELAY_MS !== undefined ? Number(env.IPAM_AUTH_FAIL_DELAY_MS) : FAIL_DELAY;

  // { id, user, hash, role, source: 'datei' | 'umgebung', createdAt, lastLogin }
  let accounts = [];
  let code = null;             // setup code, as long as no account exists
  let dummyHash = '';          // for equal timing with an unknown username
  const sessions = new Map();  // sha256(token) hex -> { uid, gen, created, seen, remember }
  const fails = new Map();     // ip -> { times: [], lockedUntil }
  let globalFails = [];
  let einrichtungLaeuft = false;
  let hashing = 0;
  let lastSessionWrite = 0;

  /* ---------- Storage ---------- */

  async function writeJson(file, data) {
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  let accountChain = Promise.resolve();
  function persistAccounts() {
    const users = accounts.filter((a) => a.source === 'datei')
      .map(({ id, user, hash, role, createdAt, changedAt, lastLogin }) => ({ id, user, hash, role, createdAt, changedAt, lastLogin }));
    // A failed write must not block the following ones.
    accountChain = accountChain.catch(() => {}).then(() => writeJson(AUTH_FILE, { version: 2, users }));
    return accountChain;
  }

  let sessionChain = Promise.resolve();
  function persistSessions() {
    lastSessionWrite = Date.now();
    const list = [...sessions.entries()].map(([h, s]) => ({ h, ...s }));
    sessionChain = sessionChain.then(() => writeJson(SESSION_FILE, { version: 2, sessions: list }))
      .catch((err) => log('Sitzungen nicht gespeichert:', err.message));
    return sessionChain;
  }

  // Reads auth.json. The 1.5/1.6 format (a single account) becomes an administrator.
  async function loadAccounts() {
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(AUTH_FILE, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log('WARNUNG: auth.json unlesbar, Einrichtung wird neu angeboten:', err.message);
      return { list: [], migriert: false };
    }
    let users = Array.isArray(raw.users) ? raw.users : [];
    let migriert = false;
    if (!raw.users && raw.user) {
      users = [{ id: crypto.randomUUID(), user: raw.user, hash: raw.hash, role: 'admin', createdAt: raw.changedAt, changedAt: raw.changedAt }];
      migriert = true;
    }
    const ok = users.filter((u) => USER_RE.test(u.user || '') && String(u.hash || '').startsWith('scrypt$'))
      .map((u) => ({
        id: String(u.id || crypto.randomUUID()), user: u.user, hash: u.hash,
        role: ROLES.includes(u.role) ? u.role : 'leser',
        source: 'datei', createdAt: u.createdAt, changedAt: u.changedAt, lastLogin: u.lastLogin,
      }));
    if (ok.length !== users.length) log(`WARNUNG: ${users.length - ok.length} ungültige Einträge in auth.json übersprungen`);
    if (migriert) log(`auth.json auf mehrere Benutzer umgestellt, «${raw.user}» ist Administrator`);
    return { list: ok, migriert };
  }

  async function init() {
    if (disabled) {
      log('WARNUNG: Anmeldung ist mit IPAM_AUTH=off abgeschaltet — die Oberfläche ist ohne Passwort erreichbar.');
      return;
    }
    dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));

    const geladen = await loadAccounts();
    accounts = geladen.list;
    if (geladen.migriert) await persistAccounts();

    if (env.IPAM_USER && env.IPAM_PASS) {
      if (!USER_RE.test(env.IPAM_USER)) throw new Error('IPAM_USER enthält unzulässige Zeichen');
      if (env.IPAM_PASS.length < MIN_PASS) log(`WARNUNG: IPAM_PASS ist kürzer als ${MIN_PASS} Zeichen.`);
      const doppelt = accounts.find((a) => sameName(a.user, env.IPAM_USER));
      if (doppelt) {
        log(`WARNUNG: «${doppelt.user}» steht in auth.json und in IPAM_USER — es gilt das Konto aus der Compose-Datei`);
        accounts = accounts.filter((a) => a !== doppelt);
      }
      accounts.unshift({ id: ENV_ID, user: env.IPAM_USER, hash: await hashPassword(env.IPAM_PASS), role: 'admin', source: 'umgebung' });
    }

    if (accounts.length) {
      log(`Anmeldung aktiv, ${accounts.length} ${accounts.length === 1 ? 'Konto' : 'Konten'}`);
    } else {
      code = setupCode();
      log('================================================================');
      log(' Noch kein Konto eingerichtet. Im Browser öffnen und mit diesem');
      log(` Einrichtungscode ein Konto anlegen:   ${code}`);
      log(' Der Code gilt bis zum nächsten Neustart des Containers.');
      log('================================================================');
    }

    // Only restore sessions whose account and password still match. An account from the
    // environment gets a new hash on every start — there, every session starts afresh.
    try {
      const s = JSON.parse(await fsp.readFile(SESSION_FILE, 'utf8'));
      for (const e of s.sessions || []) {
        if (typeof e.h !== 'string') continue;
        // Sessions from 1.5/1.6 only know the name.
        const acc = e.uid ? accounts.find((a) => a.id === e.uid) : accounts.find((a) => a.user === e.user);
        if (acc && acc.source === 'datei' && e.gen === generation(acc.hash)) {
          sessions.set(e.h, { uid: acc.id, gen: e.gen, created: e.created, seen: e.seen, remember: !!e.remember });
        }
      }
      purge();
    } catch {}
  }

  /* ---------- Sessions ---------- */

  function expired(s, now = Date.now()) {
    if (s.remember) return now - s.created > REMEMBER;
    return now - s.seen > IDLE || now - s.created > ABSOLUTE;
  }

  function purge() {
    const now = Date.now();
    for (const [h, s] of sessions) if (expired(s, now)) sessions.delete(h);
  }

  function isSecure(req) {
    if (forceSecure || req.socket.encrypted) return true;
    return vomProxy(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }

  function cookie(req, value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (maxAgeSec !== undefined) parts.push(`Max-Age=${maxAgeSec}`);
    if (isSecure(req)) parts.push('Secure');
    return parts.join('; ');
  }

  async function startSession(req, acc, remember) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    sessions.set(sha256(token).toString('hex'), {
      uid: acc.id, gen: generation(acc.hash), created: now, seen: now, remember: !!remember,
    });
    purge();
    // A single account cannot push out everyone else's sessions by logging in many times.
    const eigene = [...sessions].filter(([, s]) => s.uid === acc.id).sort((x, y) => x[1].created - y[1].created);
    while (eigene.length > MAX_SESSIONS_PRO_KONTO) sessions.delete(eigene.shift()[0]);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    await persistSessions();
    return cookie(req, token, remember ? Math.floor(REMEMBER / 1000) : undefined);
  }

  function endSessionsOf(uid, ausser = null) {
    for (const [h, s] of [...sessions]) if (s.uid === uid && h !== ausser) sessions.delete(h);
  }

  function lookup(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 100) return null;
    const h = sha256(token).toString('hex');
    const s = sessions.get(h);
    if (!s) return null;
    const acc = accounts.find((a) => a.id === s.uid);
    if (!acc || s.gen !== generation(acc.hash) || expired(s)) {
      sessions.delete(h);
      return null;
    }
    s.seen = Date.now();
    // Write last-seen only occasionally, not on every request.
    if (Date.now() - lastSessionWrite > 5 * 60 * 1000) persistSessions();
    return { hash: h, uid: acc.id, user: acc.user, role: acc.role, source: acc.source };
  }

  // For every request outside /api/auth: signed in or not, and with which role?
  function check(req) {
    if (disabled) return { user: null, role: 'admin' };
    return lookup(req);
  }

  /* ---------- Protection against guessing ---------- */

  function clientIp(req) {
    if (vomProxy(req)) {
      const cf = req.headers['cf-connecting-ip'];
      if (cf) return String(cf).trim();
      // Last entry = appended by the nearest proxy, so the client cannot forge it.
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || 'unbekannt';
  }

  function blocked(ip) {
    const now = Date.now();
    // No global lockout any more: it could be abused to lock everyone out.
    // Many failures in total or per account only throttle (see fail()).
    const f = fails.get(ip);
    if (f && f.lockedUntil > now) return Math.ceil((f.lockedUntil - now) / 1000);
    return 0;
  }

  const kontoFails = new Map(); // username -> timestamps of failed attempts

  function recordFail(ip, konto = '') {
    const now = Date.now();
    globalFails = globalFails.filter((t) => now - t < HOUR);
    globalFails.push(now);
    if (konto) {
      const k = konto.toLowerCase();
      kontoFails.set(k, [...(kontoFails.get(k) || []).filter((t) => now - t < WINDOW), now]);
      if (kontoFails.size > 10000) kontoFails.clear();
    }
    const f = fails.get(ip) || { times: [], lockedUntil: 0 };
    f.times = f.times.filter((t) => now - t < WINDOW);
    f.times.push(now);
    if (f.times.length >= MAX_FAILS_PER_IP) {
      f.lockedUntil = now + WINDOW;
      f.times = [];
      log(`Anmeldung: ${ip} nach ${MAX_FAILS_PER_IP} Fehlversuchen für 15 Minuten gesperrt`);
    }
    fails.set(ip, f);
    if (fails.size > 10000) {
      for (const [k, v] of fails) if (v.lockedUntil < now && !v.times.some((t) => now - t < WINDOW)) fails.delete(k);
    }
  }

  async function withHashSlot(fn) {
    if (hashing >= MAX_PARALLEL_HASHES) throw httpError(429, 'Zu viele gleichzeitige Anmeldeversuche, bitte kurz warten');
    hashing++;
    try { return await fn(); } finally { hashing--; }
  }

  async function fail(res, ip, status, message, what, konto = '') {
    recordFail(ip, konto);
    log(`Anmeldung fehlgeschlagen (${what}) von ${fuersLog(ip)}`);
    const viele = globalFails.length >= MAX_FAILS_GLOBAL ||
      (konto && (kontoFails.get(konto.toLowerCase()) || []).length >= MAX_FAILS_PRO_KONTO);
    if (failDelay > 0) await sleep(failDelay + (viele ? BREMSE : 0));
    return send(res, status, { error: message });
  }

  const sperrMeldung = (res, wait) => send(res, 429,
    { error: `Zu viele Fehlversuche. Erneut möglich in ${Math.ceil(wait / 60)} Min.` }, { 'Retry-After': String(wait) });

  function validNewPassword(pass, user) {
    if (typeof pass !== 'string' || pass.length < MIN_PASS) return `Passwort muss mindestens ${MIN_PASS} Zeichen lang sein`;
    if (pass.length > MAX_PASS) return `Passwort darf höchstens ${MAX_PASS} Zeichen lang sein`;
    if (user && pass.toLowerCase().includes(String(user).toLowerCase())) return 'Passwort darf den Benutzernamen nicht enthalten';
    if (/^(.)\1+$/.test(pass)) return 'Passwort besteht nur aus einem Zeichen';
    return '';
  }

  /* ---------- Endpoints under /api/auth ---------- */

  async function handle(req, res, url) {
    const what = url.pathname.split('/').filter(Boolean)[2];
    const method = req.method;
    const ip = clientIp(req);

    if (what === 'status' && method === 'GET') {
      if (disabled) return send(res, 200, { mode: 'off', authenticated: true, role: 'admin' });
      const s = lookup(req);
      return send(res, 200, {
        mode: accounts.length ? 'login' : 'setup',
        authenticated: !!s,
        user: s ? s.user : undefined,
        uid: s ? s.uid : undefined,
        role: s ? s.role : undefined,
        managedByEnv: s ? s.source === 'umgebung' : undefined,
        minPassword: MIN_PASS,
      });
    }

    if (disabled) return send(res, 404, { error: 'Anmeldung ist abgeschaltet' });

    if (what === 'login' && method === 'POST') {
      const wait = blocked(ip);
      if (wait) return sperrMeldung(res, wait);
      if (!accounts.length) return send(res, 409, { error: 'Noch kein Konto eingerichtet' });
      const body = await readBody(req, 4096);
      const user = typeof body.user === 'string' ? body.user.trim() : '';
      const pass = typeof body.password === 'string' ? body.password.slice(0, MAX_PASS) : '';
      const acc = accounts.find((a) => sameName(a.user, user));
      // Always check the password, even for an unknown name — otherwise timing reveals valid names.
      const passOk = await withHashSlot(() => verifyPassword(pass, acc ? acc.hash : dummyHash));
      if (!acc || !passOk) return fail(res, ip, 401, 'Benutzername oder Passwort falsch', `Benutzer «${fuersLog(user)}»`, user.slice(0, 64));
      fails.delete(ip);
      acc.lastLogin = new Date().toISOString();
      if (acc.source === 'datei') await persistAccounts();
      log(`Anmeldung: «${acc.user}» (${acc.role}) von ${ip}`);
      return send(res, 200, { ok: true }, { 'Set-Cookie': await startSession(req, acc, body.remember === true) });
    }

    if (what === 'setup' && method === 'POST') {
      const wait = blocked(ip);
      if (wait) return sperrMeldung(res, wait);
      if (accounts.length || !code || einrichtungLaeuft) return send(res, 409, { error: 'Konto ist bereits eingerichtet' });
      const body = await readBody(req, 4096);
      const given = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!crypto.timingSafeEqual(sha256(given), sha256(code.replace(/-/g, '')))) {
        return fail(res, ip, 401, 'Einrichtungscode stimmt nicht', 'Einrichtungscode');
      }
      const user = typeof body.user === 'string' ? body.user.trim() : '';
      if (!USER_RE.test(user)) return send(res, 400, { error: 'Benutzername: 1–64 Zeichen, erlaubt sind Buchstaben, Ziffern und . _ @ -' });
      const problem = validNewPassword(body.password, user);
      if (problem) return send(res, 400, { error: problem });
      // Two concurrent setups with a valid code must not both go through.
      if (einrichtungLaeuft || accounts.length) return send(res, 409, { error: 'Konto ist bereits eingerichtet' });
      einrichtungLaeuft = true;
      const now = new Date().toISOString();
      let acc;
      try {
        acc = {
          id: crypto.randomUUID(), user, hash: await withHashSlot(() => hashPassword(body.password)),
          role: 'admin', source: 'datei', createdAt: now, changedAt: now, lastLogin: now,
        };
      } finally {
        einrichtungLaeuft = false;
      }
      accounts = [acc];
      await persistAccounts();
      code = null;
      sessions.clear();
      log(`Konto «${user}» eingerichtet von ${ip}`);
      return send(res, 201, { ok: true }, { 'Set-Cookie': await startSession(req, acc, body.remember === true) });
    }

    if (what === 'logout' && method === 'POST') {
      const s = lookup(req);
      if (s) {
        sessions.delete(s.hash);
        await persistSessions();
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    if (what === 'password' && method === 'POST') {
      const s = lookup(req);
      if (!s) return send(res, 401, { error: 'Anmeldung erforderlich' });
      const acc = accounts.find((a) => a.id === s.uid);
      if (acc.source === 'umgebung') {
        return send(res, 409, { error: 'Das Konto wird über IPAM_USER/IPAM_PASS in der Compose-Datei verwaltet' });
      }
      const wait = blocked(ip);
      if (wait) return sperrMeldung(res, wait);
      const body = await readBody(req, 4096);
      const current = typeof body.current === 'string' ? body.current.slice(0, MAX_PASS) : '';
      if (!(await withHashSlot(() => verifyPassword(current, acc.hash)))) {
        return fail(res, ip, 403, 'Aktuelles Passwort stimmt nicht', 'Passwortwechsel');
      }
      const problem = validNewPassword(body.next, acc.user);
      if (problem) return send(res, 400, { error: problem });
      if (body.next === current) return send(res, 400, { error: 'Das neue Passwort ist dasselbe wie das alte' });
      acc.hash = await withHashSlot(() => hashPassword(body.next));
      acc.changedAt = new Date().toISOString();
      await persistAccounts();
      // Sign out all other devices; the current session stays and moves along.
      endSessionsOf(acc.id, s.hash);
      const eigene = sessions.get(s.hash);
      if (eigene) eigene.gen = generation(acc.hash);
      await persistSessions();
      log(`Passwort für «${acc.user}» geändert, andere Sitzungen beendet`);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Unbekannter Endpunkt' });
  }

  /* ---------- User management under /api/users (administrators only) ---------- */

  const adminCount = () => accounts.filter((a) => a.role === 'admin').length;

  function publicAccount(a, session) {
    const now = Date.now();
    const aktiv = [...sessions.values()].filter((s) => s.uid === a.id && !expired(s, now)).length;
    return {
      id: a.id, user: a.user, role: a.role, source: a.source,
      createdAt: a.createdAt, lastLogin: a.lastLogin, sessions: aktiv,
      self: session ? a.id === session.uid : false,
    };
  }

  async function handleUsers(req, res, url, session) {
    if (disabled) return send(res, 404, { error: 'Anmeldung ist abgeschaltet' });
    if (!session || session.role !== 'admin') return send(res, 403, { error: 'Nur für Administratoren' });
    const id = url.pathname.split('/').filter(Boolean)[2];
    const method = req.method;

    if (!id && method === 'GET') {
      return send(res, 200, { users: accounts.map((a) => publicAccount(a, session)), roles: ROLES, minPassword: MIN_PASS });
    }

    if (!id && method === 'POST') {
      const body = await readBody(req, 4096);
      const user = typeof body.user === 'string' ? body.user.trim() : '';
      if (!USER_RE.test(user)) throw httpError(400, 'Benutzername: 1–64 Zeichen, erlaubt sind Buchstaben, Ziffern und . _ @ -');
      if (accounts.some((a) => sameName(a.user, user))) throw httpError(400, `«${user}» gibt es schon`);
      if (!ROLES.includes(body.role)) throw httpError(400, 'Unbekannte Rolle');
      const problem = validNewPassword(body.password, user);
      if (problem) throw httpError(400, problem);
      const now = new Date().toISOString();
      const acc = {
        id: crypto.randomUUID(), user, hash: await withHashSlot(() => hashPassword(body.password)),
        role: body.role, source: 'datei', createdAt: now, changedAt: now,
      };
      accounts.push(acc);
      await persistAccounts();
      log(`Benutzer «${user}» (${acc.role}) angelegt von «${session.user}»`);
      return send(res, 201, publicAccount(acc, session));
    }

    const acc = accounts.find((a) => a.id === id);
    if (!acc) return send(res, 404, { error: 'Benutzer nicht gefunden' });
    if (acc.source === 'umgebung' && method !== 'GET') {
      throw httpError(409, 'Dieses Konto wird über IPAM_USER/IPAM_PASS in der Compose-Datei verwaltet');
    }

    if (method === 'PATCH') {
      const body = await readBody(req, 4096);
      const aenderungen = [];
      if (body.role !== undefined && body.role !== acc.role) {
        if (!ROLES.includes(body.role)) throw httpError(400, 'Unbekannte Rolle');
        if (acc.role === 'admin' && adminCount() === 1) throw httpError(400, 'Mindestens ein Administrator muss bleiben');
        if (acc.id === session.uid) throw httpError(400, 'Die eigene Rolle kann nur ein anderer Administrator ändern');
        acc.role = body.role;
        aenderungen.push(`Rolle ${acc.role}`);
      }
      if (body.password) {
        if (acc.id === session.uid) throw httpError(400, 'Das eigene Passwort bitte unter «Konto» ändern');
        const problem = validNewPassword(body.password, acc.user);
        if (problem) throw httpError(400, problem);
        acc.hash = await withHashSlot(() => hashPassword(body.password));
        acc.changedAt = new Date().toISOString();
        endSessionsOf(acc.id);
        aenderungen.push('Passwort neu gesetzt, Sitzungen beendet');
      }
      if (!aenderungen.length) throw httpError(400, 'Nichts geändert');
      await persistAccounts();
      await persistSessions();
      log(`Benutzer «${acc.user}»: ${aenderungen.join(', ')} — von «${session.user}»`);
      return send(res, 200, publicAccount(acc, session));
    }

    if (method === 'DELETE') {
      if (acc.id === session.uid) throw httpError(400, 'Das eigene Konto kann nicht gelöscht werden');
      if (acc.role === 'admin' && adminCount() === 1) throw httpError(400, 'Mindestens ein Administrator muss bleiben');
      accounts = accounts.filter((a) => a !== acc);
      endSessionsOf(acc.id);
      await persistAccounts();
      await persistSessions();
      log(`Benutzer «${acc.user}» gelöscht von «${session.user}»`);
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Unbekannter Endpunkt' });
  }

  return {
    init, check, handle, handleUsers,
    istSicher: isSecure,
    get enabled() { return !disabled; },
    get setupCode() { return code; },
  };
}

module.exports = { createAuth, hashPassword, verifyPassword, COOKIE, MIN_PASS, ROLES };
