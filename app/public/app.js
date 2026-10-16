'use strict';

// Übersetzung: t() für eigene Texte, tn() für Einzahl/Mehrzahl, tr() für fertige Meldungen vom Server.
const { t, tn, tr } = I18N;

/* ---------- Zustand ---------- */

let DB = { vlans: [], hosts: [], domain: 'home.arpa', version: '', settings: { theme: 'auto' } };
let selectedId = null;
let query = '';
let lastFocus = null;
let LIVE = new Map();   // IP -> { mac, name }, aus UniFi
let ZULETZT = {};       // MAC -> zuletzt gesehen (ms), aus UniFi
let AUTH = { mode: 'off' };

// Was die eigene Rolle darf. Der Server prüft dasselbe — das hier blendet nur aus.
const rolle = () => AUTH.role || (AUTH.mode === 'off' ? 'admin' : 'leser');
const darfSchreiben = () => ['admin', 'bearbeiter'].includes(rolle());
const istAdmin = () => rolle() === 'admin';

function applyRolle() {
  $('btnAccount').hidden = AUTH.mode === 'off';
  $('btnSettings').hidden = !istAdmin();
  $('btnNewVlan').hidden = !darfSchreiben();
  $('btnImport').hidden = !istAdmin();
}

const COLORS = ['blau', 'kupferton', 'gruen', 'braun', 'schiefer', 'violett'];
// Farbnamen nur für Screenreader; gespeichert wird weiterhin der deutsche Schlüssel.
const FARBNAME = { blau: t('blau'), kupferton: t('kupferton'), gruen: t('gruen'), braun: t('braun'), schiefer: t('schiefer'), violett: t('violett') };
const farbName = (c) => FARBNAME[c] || c;
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: t('Systemvorgabe'), light: t('Hell'), dark: t('Dunkel') };
const THEME_ICON = {
  auto: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.8a5.2 5.2 0 010 10.4z" fill="currentColor"/></svg>',
  light: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.1" fill="currentColor"/><path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7L13 13M13 3l-1.3 1.3M4.3 11.7L3 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  dark: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.4 9.9A5.8 5.8 0 016.1 2.6 5.9 5.9 0 108 13.9c2.4 0 4.5-1.6 5.4-4z" fill="currentColor"/></svg>',
};
const KINDS = ['statisch', 'dhcp', 'reserviert'];
// Der Typ bleibt im Bestand deutsch; übersetzt wird nur die Anzeige.
const KIND_LABEL = { statisch: t('statisch'), dhcp: t('dhcp'), reserviert: t('reserviert') };
const kindLabel = (k) => KIND_LABEL[k] || k;
// Default zones of UniFi's zone-based firewall, offered as suggestions next to existing zones.
const ZONEN = ['Internal', 'External', 'Gateway', 'DMZ', 'Hotspot', 'VPN'];
const zonenVorschlaege = () => [...new Set([...(DB.zones || []).map((z) => z.name), ...ZONEN])];

// Zone colours: a key of the validated palette (light/dark variants in style.css) or a
// custom hex colour. Text on a colour switches to dark where white would be hard to read.
const PALETTE = ['rot', 'bernstein', 'gruen', 'blau', 'violett', 'rosa', 'grau'];
const PALETTE_LABEL = {
  rot: t('Rot'), bernstein: t('Bernstein'), gruen: t('Grün'), blau: t('Blau'),
  violett: t('Violett'), rosa: t('Rosa'), grau: t('Grau'),
};
const HELLE_FARBEN = new Set(['bernstein', 'rosa']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const zoneVon = (name) => (DB.zones || []).find((z) => z.name.toLowerCase() === String(name || '').trim().toLowerCase());

// Relative luminance (WCAG): above ~0.18, dark text reads better than white.
function hellerHintergrund(hex) {
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.18;
}

function farbStil(color) {
  if (PALETTE.includes(color)) return `--dot:var(--zf-${color});--dot-text:${HELLE_FARBEN.has(color) ? 'var(--auf-hell)' : '#FFFFFF'}`;
  if (HEX_RE.test(color)) return `--dot:${color};--dot-text:${hellerHintergrund(color) ? 'var(--auf-hell)' : '#FFFFFF'}`;
  return '';
}

// CSS variables for a network: the zone's colour, or the network's own colour without a zone.
function netzStil(v) {
  const z = zoneVon(v.zone);
  if (z) return farbStil(z.color);
  return `--dot:var(--${v.color === 'orange' ? 'kupferton' : esc(v.color || 'blau')})`;
}

const zoneTag = (z, ausUnifi) => (z ? `<span class="zone-tag" title="${esc(ausUnifi ? t('Sicherheitszone aus UniFi') : t('Sicherheitszone'))}">${esc(z)}</span>` : '');
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- API ---------- */

async function call(method, path, body) {
  const headers = { 'X-IPAM-Request': '1' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Sitzung abgelaufen oder abgemeldet: zurück zur Anmeldung.
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.location.replace('/login');
    throw new Error(t('Anmeldung erforderlich'));
  }
  const data = await res.json().catch(() => ({}));
  // Fehlermeldungen des Servers kommen deutsch und werden hier übersetzt.
  if (!res.ok) throw new Error(data.error ? tr(data.error) : t('Fehler {status}', { status: res.status }));
  return data;
}

async function reload() {
  DB = await call('GET', '/api/state');
  applyTheme();
  $('btnUnifi').hidden = !DB.unifi;
  // Ohne gewähltes Netz zeigt die Hauptfläche die Übersicht.
  if (selectedId && !DB.vlans.some((v) => v.id === selectedId)) selectedId = null;
  render();
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- UniFi ---------- */

async function loadLive() {
  if (!DB.unifi) return;
  try {
    const r = await call('GET', '/api/unifi/live');
    LIVE = new Map((r.live || []).map((l) => [l.ip, l]));
    ZULETZT = r.zuletzt || {};
    // Der Server hat dabei Zonen aus UniFi übernommen: Bestand neu laden.
    if (r.zonenGeaendert) await reload();
  } catch {
    LIVE = new Map();
    ZULETZT = {};
  }
}

function syncItem(key, titel, detail) {
  return `<label class="sync-item">
    <input type="checkbox" value="${esc(key)}">
    <span class="sync-body"><span class="sync-title">${titel}</span>${detail ? `<span class="sync-detail">${detail}</span>` : ''}</span>
  </label>`;
}

// Feldnamen und Typ-Werte kommen vom Server deutsch; die Werte selbst bleiben Daten.
const feldWert = (a, w) => (a.feld === 'kind' ? kindLabel(w) : w);
const feldListe = (abw) => abw.map((a) =>
  `${esc(tr(a.label))}: <s>${esc(feldWert(a, a.ipam)) || '—'}</s> → ${esc(feldWert(a, a.unifi))}`).join(' · ');

// Kurzer Hinweis bei neuen Hosts, wenn UniFi die Adresse noch für ein anderes Gerät reserviert.
const veraltetHinweis = (v) => v
  ? `<span class="sync-warn">${esc(t('Achtung: In UniFi ist die Adresse noch fest für {name} ({mac}) reserviert — siehe «In UniFi prüfen».',
    { name: v.name || t('ein anderes Gerät'), mac: v.mac }))}</span>`
  : '';

// Ausführliche Erklärung einer veralteten Reservierung, mit dem, was in UniFi zu tun ist.
function pruefenEintrag(p) {
  const v = p.veraltet;
  const alt = v.name || t('ein Gerät ohne Namen');
  return `<div class="sync-item pruefen"><span class="sync-body">
    <span class="sync-title">${esc(p.ip)} <span class="dim">· ${esc(p.vlanName)}</span></span>
    <span class="sync-detail"><b>${esc(t('In UniFi fest reserviert für:'))}</b> ${esc(alt)} · ${esc(v.mac)}${v.lastSeen
    ? ` · ${esc(t('zuletzt gesehen {zeit}', { zeit: vorZeit(v.lastSeen) }))}` : ` · ${esc(t('von UniFi nicht mehr gesehen'))}`}</span>
    <span class="sync-detail"><b>${esc(v.aktuell?.online ? t('Hier dokumentiert und online:') : t('Hier dokumentiert:'))}</b> ${esc(p.eigen.hostname || t('ohne Namen'))} · ${esc(p.eigen.mac || v.aktuell?.mac || '')}</span>
    <span class="sync-detail sync-todo">${esc(t('Meldet sich {name} wieder, bekommt es diese Adresse zugeteilt — dann gibt es einen Konflikt.', { name: alt }))}
      ${t('In UniFi unter <i>Client Devices → {name} → Einstellungen</i> die feste IP-Adresse ausschalten oder dem neuen Gerät zuweisen.', { name: esc(alt) })}</span>
    ${darfSchreiben() ? `<span class="sync-detail"><button class="btn small" data-ignore="${esc(p.key)}" data-name="${esc(alt)}"
      title="${esc(t('Bewusst so belassen. Ändert sich die Reservierung in UniFi, erscheint der Hinweis wieder.'))}">${esc(t('Ausblenden'))}</button></span>` : ''}
  </span></div>`;
}

async function unifiDrawer(refresh = false) {
  openDrawer(t('UniFi-Abgleich'), `<p class="sync-empty">${esc(t('Controller wird abgefragt …'))}</p>`);
  let d;
  try {
    d = await call('GET', `/api/unifi/diff${refresh ? '?refresh=1' : ''}`);
  } catch (e) {
    $('drawerBody').innerHTML = `<p class="form-error" role="alert">${esc(e.message)}</p>
      <div class="drawer-actions"><button class="btn" id="retry">${esc(t('Erneut versuchen'))}</button>
      ${istAdmin() ? `<button class="btn" id="toSettings">${esc(t('Einstellungen'))}</button>` : ''}
      <button class="btn ghost" id="cancel">${esc(t('Schliessen'))}</button></div>`;
    $('retry').onclick = () => unifiDrawer(true);
    if ($('toSettings')) $('toSettings').onclick = () => settingsDrawer();
    $('cancel').onclick = closeDrawer;
    return;
  }

  const m = d.meta;
  const neueGeraete = (d.geraete || []).filter((g) => g.art === 'neu');
  const abwGeraete = (d.geraete || []).filter((g) => g.art === 'abweichend');
  const neueNetze = d.netze.filter((n) => n.art === 'neu');
  const abwNetze = d.netze.filter((n) => n.art === 'abweichend');
  const nurIpam = d.netze.filter((n) => n.art === 'nur-ipam');
  const neueHosts = d.hosts.filter((h) => h.art === 'neu');
  const abwHosts = d.hosts.filter((h) => h.art === 'abweichend');
  const offline = d.offline?.kandidaten || [];
  const offen = neueNetze.length + abwNetze.length + neueGeraete.length + abwGeraete.length +
    neueHosts.length + abwHosts.length + d.undokumentiert.length + offline.length;

  const gruppe = (titel, inhalt) => inhalt ? `<div class="sync-group"><h3>${esc(titel)}</h3>${inhalt}</div>` : '';
  const ohneNamen = t('ohne Namen');

  $('drawerBody').innerHTML = `
    <div class="sync-meta">
      <div>${esc(m.controller)}${m.version ? ` · Network ${esc(m.version)}` : ''} · Site ${esc(m.site)}</div>
      <div>${esc((m.quellen || []).map(tr).join(' · '))}</div>
      ${m.zonenInfo ? `<div>${esc(tr(m.zonenInfo))}</div>` : ''}
      ${(m.warnungen || []).map((w) => `<div class="sync-warn">${esc(tr(w))}</div>`).join('')}
    </div>

    ${offen === 0 && !(d.pruefen || []).length ? `<p class="sync-empty">${esc(t('Dokumentation und Controller stimmen überein.'))}</p>` : ''}

    ${gruppe(t('Netze im Controller, hier noch nicht erfasst'), neueNetze.map((n) =>
      syncItem(n.key, `${esc(n.unifi.name)} <span class="sync-detail" style="display:inline">VLAN ${esc(n.unifi.vid)}</span>`,
        `${esc(n.unifi.cidr)}${n.unifi.zone ? ` · ${esc(t('Zone'))} ${esc(n.unifi.zone)}` : ''}${n.unifi.gateway ? ` · Gateway ${esc(n.unifi.gateway)}` : ''}${n.unifi.dhcpFrom ? ` · DHCP ${esc(n.unifi.dhcpFrom)}–${esc(n.unifi.dhcpTo)}` : ''}`)).join(''))}

    ${gruppe(t('Netze mit Abweichung'), abwNetze.map((n) =>
      syncItem(n.key, esc(n.name), feldListe(n.abweichungen))).join(''))}

    ${gruppe(t('UniFi-Geräte, hier nicht erfasst'), neueGeraete.map((g) =>
      syncItem(g.key, esc(g.unifi.ip),
        `${esc(g.unifi.name || ohneNamen)}${g.unifi.model ? ` · ${esc(g.unifi.model)}` : ''} · ${esc(g.unifi.mac)} · ${esc(g.vlanName)}`)).join(''))}

    ${gruppe(t('Geräte mit Abweichung'), abwGeraete.map((g) =>
      syncItem(g.key, esc(g.ip), feldListe(g.abweichungen))).join(''))}

    ${gruppe(t('Feste Reservierungen, hier nicht erfasst'), neueHosts.map((h) =>
      syncItem(h.key, esc(h.unifi.ip), `${esc(h.unifi.name || h.unifi.hostname || ohneNamen)} · ${esc(h.unifi.mac)} · ${esc(h.vlanName)}${veraltetHinweis(h.veraltet)}`)).join(''))}

    ${gruppe(t('Hosts mit Abweichung'), abwHosts.map((h) =>
      syncItem(h.key, esc(h.ip), feldListe(h.abweichungen))).join(''))}

    ${(d.pruefen || []).length ? `<div class="sync-group"><h3>${esc(t('In UniFi prüfen'))}</h3>
      <p class="sync-note sync-note-top">${esc(t('Veraltete feste Reservierungen im Controller. Hier ist nichts zu übernehmen — die Dokumentation stimmt.'))}
        ${esc(t('Die App liest UniFi nur und kann die Reservierung dort nicht selbst entfernen.'))}</p>
      ${d.pruefen.map(pruefenEintrag).join('')}</div>` : ''}
    ${d.ausgeblendet ? `<p class="sync-note sync-note-top">${esc(tn(d.ausgeblendet, '1 Hinweis «In UniFi prüfen» ausgeblendet.', '{n} Hinweise «In UniFi prüfen» ausgeblendet.'))}
      ${darfSchreiben() ? `<button class="row-link" id="einblenden">${esc(t('Wieder einblenden'))}</button>` : ''}</p>` : ''}

    ${gruppe(t('Live im Netz, nirgends dokumentiert'), d.undokumentiert.map((l) =>
      syncItem(l.key, esc(l.ip), `${esc(l.name || l.hostname || ohneNamen)} · ${esc(l.mac)} · ${esc(l.vlanName)}${l.bruecke
        ? `<span class="sync-warn">${esc(t('Die MAC taucht auf mehreren Adressen auf (Gerät als Brücke, etwa eine Sonos-Soundbar) — vor dem Übernehmen prüfen.'))}</span>` : ''}`)).join(''))}

    ${gruppe(t('Seit über {tage} Tagen offline — zum Entfernen', { tage: d.offline?.tage }), offline.map((k) =>
      syncItem(k.key, esc(k.ip), `${esc(k.hostname || ohneNamen)} · ${esc(k.mac)} · ${esc(k.vlanName)} · ${esc(t('zuletzt gesehen {zeit}', { zeit: vorZeit(k.lastSeen) }))}`)).join(''))}
    ${offline.length ? `<p class="sync-note">${esc(t('Ausgewählte Einträge werden aus der Dokumentation entfernt, vorher entsteht eine Sicherung. Geräte, die sich nur selten melden, im Host als «sporadisch» markieren.'))}</p>` : ''}

    ${nurIpam.length ? `<div class="sync-group"><h3>${esc(t('Nur hier dokumentiert'))}</h3>
      ${nurIpam.map((n) => `<div class="sync-item"><span class="sync-body"><span class="sync-title">${esc(n.name)}</span>
      <span class="sync-detail">${esc(t('{cidr} — im Controller nicht gefunden', { cidr: n.cidr }))}</span></span></div>`).join('')}</div>` : ''}

    <div class="form-error" role="alert"></div>
    <div class="sync-actions">
      ${offen && darfSchreiben() ? `<button class="btn primary" id="apply">${esc(t('Auswahl übernehmen'))}</button><button class="btn" id="all">${esc(t('Alle auswählen'))}</button>` : ''}
      <button class="btn ghost" id="again">${esc(t('Neu abfragen'))}</button>
      ${istAdmin() ? `<button class="btn ghost" id="toSettings">${esc(t('Einstellungen'))}</button>` : ''}
    </div>`;

  if ($('toSettings')) $('toSettings').onclick = () => settingsDrawer();
  $('again').onclick = () => unifiDrawer(true);
  $('drawerBody').querySelectorAll('[data-ignore]').forEach((el) => {
    el.onclick = async () => {
      try {
        await call('POST', '/api/unifi/ignore', { key: el.dataset.ignore, name: el.dataset.name });
        toast(t('Hinweis ausgeblendet'));
        unifiDrawer();
      } catch (e) { toast(e.message); }
    };
  });
  if ($('einblenden')) {
    $('einblenden').onclick = async () => {
      try {
        await call('DELETE', '/api/unifi/ignore');
        unifiDrawer();
      } catch (e) { toast(e.message); }
    };
  }
  if (!darfSchreiben()) $('drawerBody').querySelectorAll('.sync-item input').forEach((el) => { el.hidden = true; });
  if (offen && darfSchreiben()) {
    $('all').onclick = () => $('drawerBody').querySelectorAll('.sync-item input').forEach((el) => { el.checked = true; });
    $('apply').onclick = async () => {
      const keys = [...$('drawerBody').querySelectorAll('.sync-item input:checked')].map((el) => el.value);
      if (!keys.length) return showErr(t('Nichts ausgewählt'));
      try {
        const r = await call('POST', '/api/unifi/apply', { keys });
        closeDrawer();
        await reload();
        await loadLive();
        render();
        const uebersprungen = (r.uebersprungen || []).length;
        toast(tn(r.angewendet.length, '1 Eintrag übernommen', '{n} Einträge übernommen') +
          (uebersprungen ? t(', {n} bereits vorhanden', { n: uebersprungen }) : ''));
      } catch (e) { showErr(e.message); }
    };
  }
}

/* ---------- Einstellungen ---------- */

async function logout() {
  try { await call('POST', '/api/auth/logout'); } catch {}
  window.location.replace('/login');
}

const UNIFI_HERKUNFT = {
  web: t('In der Oberfläche gespeichert.'),
  umgebung: t('Kommt aus der Compose-Datei. Einmal hier speichern, dann übersteht es jedes Update.'),
  keine: t('Noch nicht eingerichtet.'),
};

function settingsTabs(tab) {
  const tabs = [['unifi', 'UniFi'], ...(AUTH.mode !== 'off' ? [['benutzer', t('Benutzer')]] : [])];
  if (tabs.length < 2) return '';
  return `<div class="tabs" role="tablist">${tabs.map(([id, label]) =>
    `<button class="tab${id === tab ? ' on' : ''}" role="tab" aria-selected="${id === tab}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;
}

async function settingsDrawer(tab = 'unifi') {
  openDrawer(t('Einstellungen'), `${settingsTabs(tab)}<div id="settingsBody"><p class="sync-empty">${esc(t('Wird geladen …'))}</p></div>`);
  $('drawerBody').querySelectorAll('[data-tab]').forEach((el) => { el.onclick = () => settingsDrawer(el.dataset.tab); });
  if (tab === 'benutzer') return usersTab();
  let u;
  try {
    u = await call('GET', '/api/unifi/config');
  } catch (e) {
    $('settingsBody').innerHTML = `<p class="form-error" role="alert">${esc(e.message)}</p>`;
    return;
  }
  $('settingsBody').innerHTML = `
    <section class="settings-section">
      <h3 class="account-section">${esc(t('UniFi-Anbindung'))}</h3>
      <p class="account-note">${esc(UNIFI_HERKUNFT[u.source] || '')}</p>
      <div class="field"><label for="u-url">${esc(t('Controller-Adresse'))}</label>
        <input id="u-url" value="${esc(u.url)}" placeholder="https://10.1.1.1" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="u-key">${esc(t('API-Schlüssel'))}</label>
        <input id="u-key" type="password" autocomplete="new-password" spellcheck="false"
          placeholder="${u.hasKey ? esc(t('gespeichert {hinweis}', { hinweis: u.keyHint })) : ''}">
        <div class="hint">${esc(u.hasKey
    ? t('Leer lassen behält den gespeicherten Schlüssel.')
    : t('In UniFi Network: Einstellungen → Control Plane → Integrationen → Create New API Key.'))}</div></div>
      <div class="field"><label for="u-site">Site</label>
        <input id="u-site" value="${esc(u.site || 'default')}" spellcheck="false"></div>
      <div class="field">
        <label class="check"><input type="checkbox" id="u-verify" ${u.insecure ? '' : 'checked'}> ${esc(t('Zertifikat prüfen'))}</label>
        <div class="hint">${esc(t('Nur einschalten, wenn der Controller ein gültiges Zertifikat hat — ab Werk ist es selbst signiert.'))}</div>
        ${u.insecure && String(u.url).startsWith('https:') ? `<div class="hint seen">${u.zertifikat
    ? esc(t('Zertifikat gemerkt: {fp} — jede Verbindung wird damit verglichen, bevor der Schlüssel gesendet wird.', { fp: `${u.zertifikat.slice(0, 23)}…` }))
    : esc(t('Das Zertifikat wird bei der nächsten Verbindung gemerkt und danach bei jeder Verbindung geprüft.'))}</div>` : ''}
      </div>
      <div class="settings-result" id="u-result" role="status"></div>
      <div class="form-error" id="u-err" role="alert"></div>
      <div class="drawer-actions">
        <button class="btn primary" id="u-save">${esc(t('Speichern'))}</button>
        <button class="btn" id="u-test">${esc(t('Verbindung testen'))}</button>
        ${u.source === 'web' ? `<button class="btn destructive" id="u-del">${esc(t('Entfernen'))}</button>` : ''}
      </div>
    </section>
    ${u.configured ? `<section class="settings-section">
      <h3 class="account-section">${esc(t('Offline-Geräte'))}</h3>
      <p class="account-note">${esc(t('Dokumentierte Hosts, die UniFi länger nicht gesehen hat. Als «sporadisch» markierte Hosts sowie Geräte ohne MAC oder unbekannt bei UniFi bleiben immer stehen.'))}</p>
      <div class="field"><label for="o-tage">${esc(t('Frist in Tagen'))}</label>
        <input id="o-tage" inputmode="numeric" value="${esc(DB.settings?.offline?.tage ?? 30)}" style="max-width:110px"></div>
      <div class="field"><label class="check"><input type="checkbox" id="o-alle" ${DB.settings?.offline?.alleTypen ? 'checked' : ''}> ${esc(t('Auch statische und reservierte Einträge'))}</label>
        <div class="hint">${esc(t('Aus: nur DHCP-Einträge. Ein ausgeschalteter Server soll nicht verschwinden.'))}</div></div>
      <div class="field"><label class="check"><input type="checkbox" id="o-auto" ${DB.settings?.offline?.auto ? 'checked' : ''}> ${esc(t('Automatisch entfernen'))}</label>
        <div class="hint">${esc(t('Prüft alle sechs Stunden. Vorher entsteht eine Sicherung, jeder Eintrag steht im Protokoll. Sind mehr als die Hälfte betroffen, wird nichts entfernt.'))}</div></div>
      <div class="settings-result" id="o-result" role="status"></div>
      <div class="form-error" id="o-err" role="alert"></div>
      <div class="drawer-actions">
        <button class="btn primary" id="o-save">${esc(t('Speichern'))}</button>
        <button class="btn" id="o-preview">${esc(t('Vorschau'))}</button>
        <button class="btn" id="o-run">${esc(t('Jetzt aufräumen'))}</button>
      </div>
    </section>` : ''}`;

  /* UniFi */
  const uErr = (msg) => { $('u-err').textContent = msg; };
  const eingabe = () => ({
    url: $('u-url').value.trim(),
    key: $('u-key').value.trim(),
    site: $('u-site').value.trim(),
    insecure: !$('u-verify').checked,
  });
  const pruefen = (p) => {
    if (!p.url) return t('Controller-Adresse fehlt');
    if (!/^https?:\/\//i.test(p.url)) return t('Adresse muss mit https:// beginnen, etwa https://10.1.1.1');
    if (!p.key && !u.hasKey) return t('API-Schlüssel fehlt');
    return '';
  };

  $('u-test').onclick = async () => {
    const p = eingabe();
    const problem = pruefen(p);
    uErr(problem);
    if (problem) return;
    const out = $('u-result');
    out.className = 'settings-result';
    out.textContent = t('Controller wird abgefragt …');
    $('u-test').disabled = true;
    try {
      const r = await call('POST', '/api/unifi/test', p);
      if (r.ok) {
        out.className = 'settings-result ok';
        out.textContent = `${t('Verbindung steht')}${r.version ? ` · Network ${r.version}` : ''} · Site ${r.site} · ` +
          t('{netze} Netze, {geraete} Geräte, {live} Clients', { netze: r.netze, geraete: r.geraete, live: r.live }) +
          ((r.warnungen || []).length ? ` · ${r.warnungen.map(tr).join(' · ')}` : '') +
          (r.zertifikat ? ` · ${t('Zertifikat {fp}', { fp: `${r.zertifikat.slice(0, 23)}…` })}` : '');
      } else {
        out.textContent = '';
        uErr(t('Keine Verbindung: {fehler}', { fehler: tr(r.error) }));
      }
    } catch (e) {
      out.textContent = '';
      uErr(e.message);
    } finally {
      $('u-test').disabled = false;
    }
  };

  $('u-save').onclick = async () => {
    const p = eingabe();
    const problem = pruefen(p);
    uErr(problem);
    if (problem) return;
    try {
      await call('PUT', '/api/unifi/config', p);
      closeDrawer();
      await reload();
      await loadLive();
      render();
      toast(t('UniFi-Anbindung gespeichert'));
    } catch (e) { uErr(e.message); }
  };

  if ($('o-save')) {
    const oErr = (msg) => { $('o-err').textContent = msg; };
    const oOut = (msg, ok = false) => { $('o-result').className = `settings-result${ok ? ' ok' : ''}`; $('o-result').textContent = msg; };
    const einstellung = () => ({ tage: Number($('o-tage').value), alleTypen: $('o-alle').checked, auto: $('o-auto').checked });
    $('o-save').onclick = async () => {
      oErr('');
      try {
        DB.settings.offline = await call('PUT', '/api/unifi/offline', einstellung());
        oOut(DB.settings.offline.auto ? t('Gespeichert — entfernt automatisch nach {tage} Tagen', { tage: DB.settings.offline.tage }) : t('Gespeichert — nur von Hand'), true);
      } catch (e) { oErr(e.message); }
    };
    $('o-preview').onclick = async () => {
      oErr('');
      oOut(t('Wird geprüft …'));
      try {
        await call('PUT', '/api/unifi/offline', einstellung()).then((s) => { DB.settings.offline = s; });
        const r = await call('GET', '/api/unifi/offline');
        oOut(r.kandidaten.length
          ? `${tn(r.kandidaten.length, '1 Eintrag', '{n} Einträge')}: ${r.kandidaten.map((k) => `${k.ip} ${k.hostname || ''} (${t('{tage} T.', { tage: k.tage })})`).join(', ')}`
          : (r.ohneDaten
            ? t('Nichts zu entfernen. {geprueft} geprüft, {ohne} unbekannt bei UniFi.', { geprueft: r.geprueft, ohne: r.ohneDaten })
            : t('Nichts zu entfernen. {geprueft} geprüft.', { geprueft: r.geprueft })));
      } catch (e) { oOut(''); oErr(e.message); }
    };
    $('o-run').onclick = async () => {
      if (!confirm(t('Offline-Geräte jetzt aus der Dokumentation entfernen? Vorher entsteht eine Sicherung.'))) return;
      oErr('');
      try {
        await call('PUT', '/api/unifi/offline', einstellung()).then((s) => { DB.settings.offline = s; });
        const r = await call('POST', '/api/unifi/offline/run');
        if (r.grund) oErr(tr(r.grund));
        else oOut(r.entfernt.length ? t('{n} entfernt: {liste}', { n: r.entfernt.length, liste: r.entfernt.map((x) => x.ip).join(', ') }) : t('Nichts zu entfernen'), true);
        await reload();
      } catch (e) { oErr(e.message); }
    };
  }

  if ($('u-del')) {
    $('u-del').onclick = async () => {
      if (!confirm(t('UniFi-Anbindung entfernen? Adresse und Schlüssel werden gelöscht, der IPAM-Bestand bleibt.'))) return;
      try {
        await call('DELETE', '/api/unifi/config');
        closeDrawer();
        LIVE = new Map();
        await reload();
        toast(t('UniFi-Anbindung entfernt'));
      } catch (e) { uErr(e.message); }
    };
  }
}

/* ---------- Benutzerverwaltung ---------- */

// «Rolle|…» trennt den Rollennamen vom gleichlautenden Knopf «Bearbeiten».
const ROLLEN = [
  { id: 'admin', label: t('Rolle|Administrator'), text: t('darf alles, auch Benutzer, UniFi-Einstellungen und Import') },
  { id: 'bearbeiter', label: t('Rolle|Bearbeiten'), text: t('pflegt Netze, Hosts und übernimmt den UniFi-Abgleich') },
  { id: 'leser', label: t('Rolle|Lesen'), text: t('sieht alles, ändert nichts') },
];
const rolleLabel = (id) => ROLLEN.find((r) => r.id === id)?.label || id;

function rollenAuswahl(aktuell, gesperrt = false) {
  return `<select id="u-role" ${gesperrt ? 'disabled' : ''}>${ROLLEN.map((r) =>
    `<option value="${r.id}" ${r.id === aktuell ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
    <div class="hint" id="u-role-hint">${esc(ROLLEN.find((r) => r.id === aktuell)?.text || '')}</div>`;
}

function rollenHinweisVerdrahten() {
  const sel = $('u-role');
  if (sel) sel.onchange = () => { $('u-role-hint').textContent = ROLLEN.find((r) => r.id === sel.value)?.text || ''; };
}

async function usersTab(ansicht = null) {
  const box = $('settingsBody');
  let d;
  try {
    d = await call('GET', '/api/users');
  } catch (e) {
    box.innerHTML = `<p class="form-error" role="alert">${esc(e.message)}</p>`;
    return;
  }
  const min = d.minPassword || 12;
  const fehler = (msg) => { $('us-err').textContent = msg; };

  if (ansicht === 'neu') {
    box.innerHTML = `
      <h3 class="account-section">${esc(t('Benutzer anlegen'))}</h3>
      <div class="field"><label for="u-name">${esc(t('Benutzername'))}</label>
        <input id="u-name" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="u-role">${esc(t('Rolle'))}</label>${rollenAuswahl('bearbeiter')}</div>
      <div class="field"><label for="u-pass">${esc(t('Passwort'))}</label>
        <input id="u-pass" type="password" autocomplete="new-password">
        <div class="hint">${esc(t('Mindestens {n} Zeichen. Teile es der Person auf einem sicheren Weg mit.', { n: min }))}</div></div>
      <div class="field"><label for="u-pass2">${esc(t('Passwort wiederholen'))}</label>
        <input id="u-pass2" type="password" autocomplete="new-password"></div>
      <div class="form-error" id="us-err" role="alert"></div>
      <div class="drawer-actions">
        <button class="btn primary" id="us-save">${esc(t('Anlegen'))}</button>
        <button class="btn ghost" id="us-back">${esc(t('Zurück'))}</button>
      </div>`;
    rollenHinweisVerdrahten();
    $('u-name').focus();
    $('us-back').onclick = () => usersTab();
    $('us-save').onclick = async () => {
      const user = $('u-name').value.trim();
      const password = $('u-pass').value;
      if (!user) return fehler(t('Benutzername fehlt'));
      if (password.length < min) return fehler(t('Passwort muss mindestens {n} Zeichen lang sein', { n: min }));
      if (password !== $('u-pass2').value) return fehler(t('Die beiden Passwörter stimmen nicht überein'));
      try {
        await call('POST', '/api/users', { user, role: $('u-role').value, password });
        toast(t('«{user}» angelegt', { user }));
        usersTab();
      } catch (e) { fehler(e.message); }
    };
    return;
  }

  if (ansicht) {
    const u = d.users.find((x) => x.id === ansicht);
    if (!u) return usersTab();
    const env = u.source === 'umgebung';
    box.innerHTML = `
      <h3 class="account-section">${esc(u.user)}${u.self ? ` <span class="dim">${esc(t('(du)'))}</span>` : ''}</h3>
      ${env ? `<p class="account-note">${esc(t('Dieses Konto steht in der Compose-Datei (IPAM_USER/IPAM_PASS) und lässt sich nur dort ändern.'))}</p>` : ''}
      <div class="field"><label for="u-role">${esc(t('Rolle'))}</label>${rollenAuswahl(u.role, env || u.self)}
        ${u.self && !env ? `<div class="hint">${esc(t('Die eigene Rolle ändert ein anderer Administrator.'))}</div>` : ''}</div>
      ${env || u.self ? '' : `<h3 class="account-section">${esc(t('Passwort neu setzen'))}</h3>
      <div class="field"><label for="u-pass">${esc(t('Neues Passwort'))}</label>
        <input id="u-pass" type="password" autocomplete="new-password">
        <div class="hint">${esc(t('Leer lassen behält das Passwort. Ein neues meldet {user} auf allen Geräten ab.', { user: u.user }))}</div></div>
      <div class="field"><label for="u-pass2">${esc(t('Neues Passwort wiederholen'))}</label>
        <input id="u-pass2" type="password" autocomplete="new-password"></div>`}
      ${u.self && !env ? `<p class="account-note">${esc(t('Das eigene Passwort änderst du über das Benutzersymbol oben rechts.'))}</p>` : ''}
      <div class="form-error" id="us-err" role="alert"></div>
      <div class="drawer-actions">
        ${env || u.self ? '' : `<button class="btn primary" id="us-save">${esc(t('Speichern'))}</button>`}
        <button class="btn ghost" id="us-back">${esc(t('Zurück'))}</button>
        ${env || u.self ? '' : `<button class="btn destructive" id="us-del">${esc(t('Löschen'))}</button>`}
      </div>`;
    rollenHinweisVerdrahten();
    $('us-back').onclick = () => usersTab();
    if (env || u.self) return;
    $('us-save').onclick = async () => {
      const body = {};
      if ($('u-role').value !== u.role) body.role = $('u-role').value;
      const pass = $('u-pass').value;
      if (pass) {
        if (pass.length < min) return fehler(t('Passwort muss mindestens {n} Zeichen lang sein', { n: min }));
        if (pass !== $('u-pass2').value) return fehler(t('Die beiden Passwörter stimmen nicht überein'));
        body.password = pass;
      }
      if (!Object.keys(body).length) return fehler(t('Nichts geändert'));
      try {
        await call('PATCH', `/api/users/${encodeURIComponent(u.id)}`, body);
        toast(t('«{user}» gespeichert', { user: u.user }));
        usersTab();
      } catch (e) { fehler(e.message); }
    };
    $('us-del').onclick = async () => {
      if (!confirm(t('«{user}» löschen? Die Person wird sofort abgemeldet.', { user: u.user }))) return;
      try {
        await call('DELETE', `/api/users/${encodeURIComponent(u.id)}`);
        toast(t('«{user}» gelöscht', { user: u.user }));
        usersTab();
      } catch (e) { fehler(e.message); }
    };
    return;
  }

  box.innerHTML = `
    <ul class="user-list">${d.users.map((u) => `<li>
      <div class="user-main">
        <span class="user-name">${esc(u.user)}${u.self ? ` <span class="dim">${esc(t('(du)'))}</span>` : ''}</span>
        <span class="tag role-${esc(u.role)}">${esc(rolleLabel(u.role))}</span>
      </div>
      <div class="user-meta">${esc(u.lastLogin ? t('zuletzt angemeldet {zeit}', { zeit: vorZeit(u.lastLogin) }) : t('noch nie angemeldet'))}${
  u.sessions ? ` · ${esc(tn(u.sessions, '1 Sitzung', '{n} Sitzungen'))}` : ''}${
  u.source === 'umgebung' ? ` · ${esc(t('aus der Compose-Datei'))}` : ''}</div>
      <button class="btn small user-edit" data-user="${esc(u.id)}">${esc(u.source === 'umgebung' ? t('Ansehen') : t('Bearbeiten'))}</button>
    </li>`).join('')}</ul>
    <div class="drawer-actions"><button class="btn primary" id="us-new">${esc(t('Benutzer anlegen'))}</button></div>
    <dl class="role-legend">${ROLLEN.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.text)}</dd>`).join('')}</dl>`;
  $('us-new').onclick = () => usersTab('neu');
  box.querySelectorAll('[data-user]').forEach((el) => { el.onclick = () => usersTab(el.dataset.user); });
}

/* ---------- Konto ---------- */

function accountDrawer() {
  const env = AUTH.managedByEnv;
  const min = AUTH.minPassword || 12;

  openDrawer(t('Konto'), `
    <p class="account-user">${t('Angemeldet als <b>{user}</b> · {rolle}', { user: esc(AUTH.user), rolle: esc(rolleLabel(rolle())) })}</p>
    ${env
    ? `<p class="account-note">${esc(t('Dieses Konto wird über IPAM_USER und IPAM_PASS in der Compose-Datei verwaltet. Das Passwort lässt sich nur dort ändern.'))}</p>`
    : `<h3 class="account-section">${esc(t('Passwort ändern'))}</h3>
    <input type="text" autocomplete="username" value="${esc(AUTH.user)}" hidden>
    <div class="field"><label for="a-cur">${esc(t('Aktuelles Passwort'))}</label>
      <input id="a-cur" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="a-new">${esc(t('Neues Passwort'))}</label>
      <input id="a-new" type="password" autocomplete="new-password">
      <div class="hint">${esc(t('Mindestens {n} Zeichen. Andere Geräte werden danach abgemeldet.', { n: min }))}</div></div>
    <div class="field"><label for="a-new2">${esc(t('Neues Passwort wiederholen'))}</label>
      <input id="a-new2" type="password" autocomplete="new-password"></div>
    <div class="form-error" id="a-err" role="alert"></div>`}
    <div class="drawer-actions">
      ${env ? '' : `<button class="btn primary" id="a-save">${esc(t('Passwort ändern'))}</button>`}
      <button class="btn destructive" id="logout">${esc(t('Abmelden'))}</button>
    </div>`);

  $('logout').onclick = logout;
  if (env) return;
  $('a-save').onclick = async () => {
    const aErr = (msg) => { $('a-err').textContent = msg; };
    const current = $('a-cur').value;
    const next = $('a-new').value;
    if (!current) return aErr(t('Aktuelles Passwort fehlt'));
    if (next.length < min) return aErr(t('Neues Passwort muss mindestens {n} Zeichen lang sein', { n: min }));
    if (next !== $('a-new2').value) return aErr(t('Die beiden neuen Passwörter stimmen nicht überein'));
    try {
      await call('POST', '/api/auth/password', { current, next });
      closeDrawer();
      toast(t('Passwort geändert, andere Geräte abgemeldet'));
    } catch (e) { aErr(e.message); }
  };
}

/* ---------- Erscheinungsbild ---------- */

function applyTheme() {
  const thema = THEMES.includes(DB.settings?.theme) ? DB.settings.theme : 'auto';
  document.documentElement.dataset.theme = thema;
  const btn = $('btnTheme');
  btn.innerHTML = THEME_ICON[thema];
  btn.title = t('Erscheinungsbild: {name}', { name: THEME_LABEL[thema] });
  btn.setAttribute('aria-label', t('Erscheinungsbild: {name}. Umschalten.', { name: THEME_LABEL[thema] }));
}

async function cycleTheme() {
  const cur = THEMES.includes(DB.settings?.theme) ? DB.settings.theme : 'auto';
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  DB.settings = { ...DB.settings, theme: next };
  applyTheme();
  try {
    await call('PATCH', '/api/settings', { theme: next });
    toast(t('Erscheinungsbild: {name}', { name: THEME_LABEL[next] }));
  } catch (e) {
    toast(t('Nicht gespeichert: {fehler}', { fehler: e.message }));
  }
}

/* ---------- IPv4-Mathematik ---------- */

function ipToInt(ip) {
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
}

const intToIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

function parseCidr(cidr) {
  const m = String(cidr ?? '').trim().match(/^([\d.]+)\/(\d{1,2})$/);
  if (!m) return null;
  const base = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (base === null || prefix > 32) return null;
  const size = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (base & mask) >>> 0;
  const bcast = net + size - 1;
  return {
    prefix, size, net, bcast,
    first: size > 2 ? net + 1 : net,
    last: size > 2 ? bcast - 1 : bcast,
    usable: size > 2 ? size - 2 : size,
  };
}

const isIpv6ish = (s) => /^[0-9a-f:]+\/\d{1,3}$/i.test(String(s ?? '').trim()) && String(s).includes(':');

function hostMap(vlanId) {
  const map = new Map();
  for (const h of DB.hosts) {
    if (h.vlanId !== vlanId) continue;
    const n = ipToInt(h.ip);
    if (n !== null) map.set(n, h);
  }
  return map;
}

function nextFreeIp(vlan) {
  const r = parseCidr(vlan.cidr);
  if (!r) return '';
  const used = hostMap(vlan.id);
  const gw = ipToInt(vlan.gateway);
  const from = ipToInt(vlan.dhcpFrom);
  const to = ipToInt(vlan.dhcpTo);
  for (let n = r.first; n <= r.last; n++) {
    if (used.has(n) || n === gw) continue;
    if (from !== null && to !== null && n >= from && n <= to) continue;
    return intToIp(n);
  }
  return '';
}

// Je Netz und Adresse darf es nur einen Eintrag geben.
function doppelte() {
  const zaehler = new Map();
  for (const h of DB.hosts) {
    const k = `${h.vlanId}|${h.ip}`;
    zaehler.set(k, (zaehler.get(k) || 0) + 1);
  }
  return [...zaehler.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
}

const sortedVlans = () => DB.vlans.slice().sort((a, b) => (a.vid || 0) - (b.vid || 0) || a.name.localeCompare(b.name));
const hostsOf = (id) => DB.hosts.filter((h) => h.vlanId === id)
  .sort((a, b) => (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0));

/* ---------- Seitenleiste ---------- */

function renderRail() {
  $('vlanList').innerHTML = sortedVlans().map((v) => {
    const r = parseCidr(v.cidr);
    const count = DB.hosts.filter((h) => h.vlanId === v.id).length;
    const pct = r ? Math.min(100, Math.round((count / r.usable) * 100)) : 0;
    return `<li><button class="vlan-item ${v.id === selectedId ? 'active' : ''}" data-vlan="${esc(v.id)}" style="${netzStil(v)}">
      <span class="vlan-item-top"><span class="vid">${esc(v.vid)}</span><span class="vlan-name">${esc(v.name)}</span>${zoneTag(v.zone, v.zoneAusUnifi)}</span>
      <span class="vlan-cidr">${esc(v.cidr)} · ${esc(tn(count, '1 Eintrag', '{n} Einträge'))}</span>
      <span class="usage-bar"><span class="usage-fill" style="width:${pct}%"></span></span>
    </button></li>`;
  }).join('');

  $('navOverview').classList.toggle('active', !query && !DB.vlans.some((v) => v.id === selectedId));
  $('railFoot').textContent = `${tn(DB.vlans.length, '1 Netz', '{n} Netze')} · ${tn(DB.hosts.length, '1 Eintrag', '{n} Einträge')} · ${DB.domain}`;
  $('version').textContent = DB.version ? `v${DB.version}` : '';

  $('vlanList').querySelectorAll('[data-vlan]').forEach((el) => {
    el.onclick = () => {
      selectedId = el.dataset.vlan;
      $('main').scrollTop = 0;
      query = '';
      $('search').value = '';
      closeRail();
      render();
    };
  });
}

/* ---------- Hauptbereich ---------- */

function render() {
  renderRail();
  const main = $('main');
  renderHinweis();

  if (query) return renderSearch(main);

  if (!DB.vlans.length) {
    main.innerHTML = `<div class="empty">
      <h1>${esc(t('Noch keine Netze erfasst'))}</h1>
      <p>${esc(t('Leg dein erstes Netz an — VLAN-ID, Name und Subnetz genügen. Hosts und DNS-Namen kommen danach dazu.'))}</p>
      ${darfSchreiben() ? `<button class="btn primary" id="emptyNew">${esc(t('Netz anlegen'))}</button>` : ''}
    </div>`;
    if ($('emptyNew')) $('emptyNew').onclick = () => vlanForm();
    return;
  }

  const v = DB.vlans.find((x) => x.id === selectedId);
  if (!v) return renderOverview(main);
  renderVlan(main, v);
}

function renderHinweis() {
  const el = $('hinweis');
  const n = doppelte();
  if (!n) { el.hidden = true; el.innerHTML = ''; return; }

  el.innerHTML = `<span>${esc(tn(n, '1 doppelter Eintrag — dieselbe Adresse ist im selben Netz mehrfach erfasst.',
    '{n} doppelte Einträge — dieselbe Adresse ist im selben Netz mehrfach erfasst.'))}</span>
    ${darfSchreiben() ? `<button class="btn small" id="dedupe">${esc(t('Bereinigen'))}</button>` : ''}`;
  el.hidden = false;
  if (!darfSchreiben()) return;

  $('dedupe').onclick = async () => {
    if (!confirm(tn(n, '1 Eintrag wird zusammengeführt. Felder, die nur im entfernten Eintrag stehen, werden übernommen. Fortfahren?',
      '{n} Einträge werden zusammengeführt. Felder, die nur im entfernten Eintrag stehen, werden übernommen. Fortfahren?'))) return;
    try {
      const r = await call('POST', '/api/hosts/dedupe');
      await reload();
      toast(tn(r.entfernt, '1 Eintrag entfernt', '{n} Einträge entfernt'));
    } catch (e) { toast(e.message); }
  };
}

function renderVlan(main, v) {
  const r = parseCidr(v.cidr);
  const hosts = hostsOf(v.id);
  const free = r ? Math.max(0, r.usable - hosts.length) : null;

  main.innerHTML = `<div style="${netzStil(v)}">
    <div class="detail-head">
      <div>
        <h1>${esc(v.name)}</h1>
        <div class="detail-sub">
          <span>VLAN <b>${esc(v.vid)}</b></span>
          <span>${esc(v.cidr)}</span>
          ${v.zone ? `<span>${esc(t('Zone'))} <b>${esc(v.zone)}</b>${v.zoneAusUnifi ? ` <span class="dim">${esc(t('aus UniFi'))}</span>` : ''}</span>` : ''}
          ${v.gateway ? `<span>Gateway <b>${esc(v.gateway)}</b></span>` : ''}
          ${v.dhcpFrom && v.dhcpTo ? `<span>DHCP ${esc(v.dhcpFrom)} – ${esc(v.dhcpTo)}</span>` : ''}
        </div>
      </div>
      <div class="head-actions">
        ${darfSchreiben() ? `<button class="btn small" id="editVlan">${esc(t('Netz bearbeiten'))}</button>
        <button class="btn small primary" id="addHost">${esc(t('Host hinzufügen'))}</button>` : `<button class="btn small" id="editVlan">${esc(t('Details'))}</button>`}
      </div>
    </div>

    ${v.purpose ? `<p class="purpose">${esc(v.purpose)}</p>` : ''}
    ${v.notes ? `<div class="note-block">${esc(v.notes)}</div>` : ''}

    <div class="stats">
      <div><div class="stat-num">${hosts.length}</div><div class="stat-label">${esc(t('erfasst'))}</div></div>
      <div><div class="stat-num">${free === null ? '–' : free}</div><div class="stat-label">${esc(t('frei'))}</div></div>
      <div><div class="stat-num">${r ? r.usable : '–'}</div><div class="stat-label">${esc(t('nutzbar'))}</div></div>
    </div>

    ${gridHtml(v, r)}

    <div class="section-head"><h2>Hosts</h2><span class="count">${hosts.length}</span></div>
    ${hosts.length ? hostTable(hosts) : `<p class="purpose">${esc(t('Noch nichts erfasst. Klick im Raster auf eine freie Adresse.'))}</p>`}
  </div>`;

  $('editVlan').onclick = () => vlanForm(v);
  if ($('addHost')) $('addHost').onclick = () => {
    const ip = nextFreeIp(v);
    if (!ip && parseCidr(v.cidr)) return toast(t('Kein Platz mehr in diesem Netz'));
    hostForm({ vlanId: v.id, ip });
  };
  wireCells(v);
  wireRows();
}

function gridHtml(v, r) {
  if (!r) {
    return `<p class="purpose">${esc(isIpv6ish(v.cidr)
      ? t('IPv6-Netz — das Raster bleibt aus, die Hostliste funktioniert weiter.')
      : t('Kein gültiges IPv4-Subnetz hinterlegt, deshalb kein Raster.'))}</p>`;
  }
  if (r.size > 1024) return `<p class="purpose">${esc(t('Netz grösser als /22 — Raster ausgeblendet, siehe Hostliste.'))}</p>`;

  const used = hostMap(v.id);
  const gw = ipToInt(v.gateway);
  const from = ipToInt(v.dhcpFrom);
  const to = ipToInt(v.dhcpTo);
  const perRow = r.size > 256 ? 32 : 16;
  const rows = [];

  for (let start = r.net; start <= r.bcast; start += perRow) {
    const cells = [];
    for (let n = start; n < start + perRow && n <= r.bcast; n++) {
      const ip = intToIp(n);
      const h = used.get(n);
      let cls = 'cell';
      let title = ip;

      if (r.size > 2 && (n === r.net || n === r.bcast)) {
        cells.push(`<span class="cell edge" title="${ip} · ${esc(n === r.net ? t('Netzadresse') : 'Broadcast')}"></span>`);
        continue;
      }
      const liveInfo = LIVE.get(ip);
      if (h) {
        cls += h.kind === 'dhcp' ? ' dhcp' : h.kind === 'reserviert' ? ' used reserved' : ' used';
        title += ` · ${h.kind === 'reserviert' ? t('reserviert') : h.kind === 'dhcp' ? t('DHCP-Lease') : t('statisch')}`;
        title += ` · ${h.hostname || h.fqdn || t('ohne Namen')}`;
        if (liveInfo) { cls += ' live'; title += ` · ${t('online')}`; }
      } else if (liveInfo) {
        cls += ' ghost';
        title += ` · ${t('online, nicht dokumentiert')}${liveInfo.name ? ` (${liveInfo.name})` : ''}`;
      } else if (n === gw) {
        cls += ' gw';
        title += ' · Gateway';
      } else if (from !== null && to !== null && n >= from && n <= to) {
        cls += ' pool';
        title += ` · ${t('DHCP-Bereich')}`;
      }
      cells.push(`<button class="${cls}" title="${esc(title)}" aria-label="${esc(title)}" data-ip="${ip}" data-host="${h ? esc(h.id) : ''}"></button>`);
    }
    const label = r.prefix >= 24 ? `.${start & 255}` : `${(start >>> 8) & 255}.${start & 255}`;
    rows.push(`<div class="grid-row"><span class="row-label">${label}</span>${cells.join('')}</div>`);
  }

  return `<div class="grid-wrap">
    ${rows.join('')}
    <div class="legend">
      <span><i style="background:var(--dot)"></i>${esc(t('statisch'))}</span>
      <span><i class="res" style="background:var(--dot)"></i>${esc(t('reserviert'))}</span>
      <span><i style="background:var(--schiefer)"></i>${esc(t('DHCP-Lease'))}</span>
      <span><i style="background:var(--gateway)"></i>Gateway</span>
      <span><i style="background:var(--zelle-pool)"></i>${esc(t('DHCP-Bereich'))}</span>
      <span><i style="background:var(--zelle-frei)"></i>${esc(t('frei'))}</span>
      ${DB.unifi ? `<span><i style="background:var(--zelle-frei);box-shadow:inset 0 0 0 2px var(--text)"></i>${esc(t('online'))}</span><span><i style="background:repeating-linear-gradient(45deg,var(--zelle-frei) 0 2px,var(--kupfer) 2px 4px)"></i>${esc(t('online, nicht dokumentiert'))}</span>` : ''}
    </div>
  </div>`;
}

function hostTable(hosts, showVlan = false) {
  return `<div class="table-wrap"><table><thead><tr>
      <th>${esc(t('Adresse'))}</th>${showVlan ? `<th>${esc(t('Netz'))}</th>` : ''}
      <th>${esc(t('Name'))}</th><th>DNS</th><th>MAC</th><th>${esc(t('Rolle'))}</th><th>${esc(t('Typ'))}</th><th class="note">${esc(t('Notiz'))}</th>
    </tr></thead><tbody>
    ${hosts.map((h) => {
      const v = DB.vlans.find((x) => x.id === h.vlanId);
      return `<tr>
        <td class="ip"><button class="row-link" data-host="${esc(h.id)}">${esc(h.ip)}</button></td>
        ${showVlan ? `<td>${v ? `${esc(v.vid)} ${esc(v.name)}` : '<span class="dash">–</span>'}</td>` : ''}
        <td>${esc(h.hostname) || '<span class="dash">–</span>'}</td>
        <td class="fq">${esc(h.fqdn)}</td>
        <td class="mac">${esc(h.mac)}</td>
        <td>${esc(h.role)}</td>
        <td>${h.kind === 'statisch' ? '' : `<span class="tag ${esc(h.kind)}">${esc(kindLabel(h.kind))}</span>`}${h.sporadisch ? ` <span class="tag" title="${esc(t('meldet sich nur sporadisch'))}">${esc(t('sporadisch'))}</span>` : ''}</td>
        <td class="note">${esc(h.notes)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function wireCells(v) {
  document.querySelectorAll('.cell[data-ip]').forEach((el) => {
    el.onclick = () => {
      const hostId = el.dataset.host;
      if (hostId) return hostForm(DB.hosts.find((h) => h.id === hostId));
      if (!darfSchreiben()) return;
      const ip = el.dataset.ip;
      const l = LIVE.get(ip);
      hostForm({
        vlanId: v.id, ip,
        hostname: l?.name || '', mac: l?.mac || '',
        kind: l ? 'dhcp' : 'statisch',
      });
    };
  });
}

function wireRows() {
  document.querySelectorAll('.row-link[data-host]').forEach((el) => {
    el.onclick = () => hostForm(DB.hosts.find((h) => h.id === el.dataset.host));
  });
}

/* ---------- Übersicht ---------- */

// Typen bekommen keine eigenen Farben: Farbe heisst in der App «Netz» bzw. «Zone».
// Der Typ steht als Zahl in der Übersicht und als Form im Raster (reserviert = Ecke).
const TYPEN = [
  { kind: 'statisch', label: t('statisch'), text: t('am Gerät eingestellt') },
  { kind: 'reserviert', label: t('reserviert'), text: t('vom DHCP-Server fest vergeben') },
  { kind: 'dhcp', label: t('DHCP'), text: t('dynamisch vergeben') },
];

const zahl = (n) => Number(n).toLocaleString(I18N.locale());
const prozent = (teil, ganz) => (ganz ? Math.round((teil / ganz) * 100) : 0);

function vorZeit(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return t('gerade eben');
  if (s < 3600) return t('vor {n} Min.', { n: Math.floor(s / 60) });
  if (s < 86400) return t('vor {n} Std.', { n: Math.floor(s / 3600) });
  const d = Math.floor(s / 86400);
  if (d < 365) return tn(d, 'vor 1 Tag', 'vor {n} Tagen');
  return new Date(iso).toLocaleDateString(I18N.locale());
}

// Kennzahlen eines Netzes. Grosse Netze werden nicht Adresse für Adresse durchlaufen.
function netzStatistik(v) {
  const r = parseCidr(v.cidr);
  const hosts = DB.hosts.filter((h) => h.vlanId === v.id);
  const typ = { statisch: 0, dhcp: 0, reserviert: 0 };
  for (const h of hosts) typ[h.kind in typ ? h.kind : 'statisch']++;

  const from = ipToInt(v.dhcpFrom);
  const to = ipToInt(v.dhcpTo);
  const pool = from !== null && to !== null && to >= from ? to - from + 1 : 0;

  let online = null;
  let fremd = null;
  if (DB.unifi && r) {
    const eigene = new Set(hosts.map((h) => h.ip));
    online = hosts.filter((h) => LIVE.has(h.ip)).length;
    fremd = 0;
    for (const ip of LIVE.keys()) {
      const n = ipToInt(ip);
      if (n !== null && n >= r.net && n <= r.bcast && !eigene.has(ip) && ip !== v.gateway) fremd++;
    }
  }

  return {
    v, r, hosts, typ, pool, online, fremd,
    nutzbar: r ? r.usable : null,
    frei: r ? Math.max(0, r.usable - hosts.length) : null,
    naechste: r && r.size <= 65536 ? nextFreeIp(v) : '',
  };
}

// Prüfungen über den ganzen Bestand. Jede liefert betroffene Einträge zum Anklicken.
function auffaelligkeiten(stats) {
  const liste = [];
  const aus = new Set((DB.ignoriert || []).map((i) => i.key));
  const netzVon = new Map(DB.vlans.map((v) => [v.id, v]));
  const hostEintrag = (h, zusatz = '', ign = '') => ({
    host: h.id,
    ign,
    text: `${h.ip}  ${h.hostname || t('ohne Namen')}${zusatz ? ` · ${zusatz}` : ''}`,
  });

  const imPool = [];
  const ausserhalb = [];
  for (const s of stats) {
    if (!s.r) continue;
    const from = ipToInt(s.v.dhcpFrom);
    const to = ipToInt(s.v.dhcpTo);
    for (const h of s.hosts) {
      const n = ipToInt(h.ip);
      if (n === null || n < s.r.net || n > s.r.bcast) { ausserhalb.push(hostEintrag(h, s.v.name, `auf:ausserhalb:${h.id}`)); continue; }
      if (h.kind === 'statisch' && from !== null && to !== null && n >= from && n <= to) imPool.push(hostEintrag(h, s.v.name, `auf:pool:${h.id}`));
    }
  }
  liste.push({
    titel: t('Statische Adresse im DHCP-Bereich'),
    erklaerung: t('Der DHCP-Server kann diese Adresse an ein anderes Gerät vergeben — dann gibt es einen Konflikt. Als Reservierung erfassen oder ausserhalb des Bereichs legen.'),
    eintraege: imPool,
  });

  const dopAdr = new Map();
  for (const h of DB.hosts) {
    const k = `${h.vlanId}|${h.ip}`;
    dopAdr.set(k, [...(dopAdr.get(k) || []), h]);
  }
  liste.push({
    titel: t('Adresse mehrfach erfasst'),
    erklaerung: t('Lässt sich über die Hinweisleiste oben zusammenführen.'),
    eintraege: [...dopAdr.values()].filter((g) => g.length > 1).map((g) => hostEintrag(g[0], `${g.length}×`, `auf:ipdup:${g[0].vlanId}|${g[0].ip}`)),
  });

  const dopMac = new Map();
  for (const h of DB.hosts) {
    if (!h.mac) continue;
    const k = `${h.vlanId}|${h.mac.toLowerCase().replace(/-/g, ':')}`;
    dopMac.set(k, [...(dopMac.get(k) || []), h]);
  }
  liste.push({
    titel: t('Gleiche MAC im selben Netz'),
    erklaerung: t('Ein Gerät mit mehreren Adressen im selben Netz — gewollt, oder ein Überbleibsel? Geräte, die andere durchreichen (etwa eine Sonos-Soundbar), können das auslösen.'),
    eintraege: [...dopMac.values()].filter((g) => g.length > 1)
      .flatMap((g) => g.map((h) => hostEintrag(h, h.mac, `auf:mac:${h.vlanId}|${h.mac.toLowerCase().replace(/-/g, ':')}`))),
  });

  liste.push({
    titel: t('Adresse ausserhalb des Netzes'),
    erklaerung: t('Meist aus einem Import oder nach einer Änderung des Subnetzes.'),
    eintraege: ausserhalb,
  });

  const ueberlapp = [];
  const parsed = stats.filter((s) => s.r);
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      if (a.r.net <= b.r.bcast && b.r.net <= a.r.bcast) {
        ueberlapp.push({ vlan: a.v.id, text: `${a.v.cidr} ${a.v.name} ↔ ${b.v.cidr} ${b.v.name}`, ign: `auf:overlap:${a.v.id}|${b.v.id}` });
      }
    }
  }
  liste.push({ titel: t('Überlappende Netze'), erklaerung: t('Zwei Netze teilen sich Adressen.'), eintraege: ueberlapp });

  liste.push({
    titel: t('Netz ohne Gateway'),
    erklaerung: '',
    eintraege: stats.filter((s) => s.r && !s.v.gateway).map((s) => ({ vlan: s.v.id, text: `${s.v.cidr}  ${s.v.name}`, ign: `auf:gateway:${s.v.id}` })),
  });

  if (DB.unifi || DB.vlans.some((v) => v.zone)) {
    liste.push({
      titel: t('Netz ohne Sicherheitszone'),
      erklaerung: t('Ohne Zone ist nicht ersichtlich, welche Firewall-Regeln für das Netz gelten.'),
      eintraege: stats.filter((s) => !s.v.zone).map((s) => ({ vlan: s.v.id, text: `${s.v.cidr}  ${s.v.name}`, ign: `auf:zone:${s.v.id}` })),
    });
  }

  if (DB.unifi) {
    const o = { tage: 30, alleTypen: false, ...(DB.settings?.offline || {}) };
    const online = new Set([...LIVE.values()].map((l) => l.mac));
    const lange = DB.hosts.filter((h) => {
      if (h.sporadisch || !h.mac || (!o.alleTypen && h.kind !== 'dhcp')) return false;
      const mac = h.mac.toLowerCase().replace(/-/g, ':');
      const zuletzt = ZULETZT[mac];
      return !online.has(mac) && zuletzt && Date.now() - zuletzt >= o.tage * 86400000;
    });
    liste.push({
      titel: t('Seit über {tage} Tagen offline', { tage: o.tage }),
      erklaerung: o.auto
        ? t('Laut UniFi länger nicht gesehen — wird automatisch entfernt. Seltene Geräte im Host als «sporadisch» markieren.')
        : t('Laut UniFi länger nicht gesehen. Entfernen über «UniFi» oder automatisch in den Einstellungen. Seltene Geräte im Host als «sporadisch» markieren.'),
      eintraege: lange.map((h) => hostEintrag(h, t('zuletzt {zeit}', { zeit: vorZeit(new Date(ZULETZT[h.mac.toLowerCase().replace(/-/g, ':')]).toISOString()) }))),
    });
  }

  liste.push({
    titel: t('Host ohne Namen'),
    erklaerung: '',
    eintraege: DB.hosts.filter((h) => !h.hostname && !h.fqdn)
      .sort((a, b) => (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0))
      .map((h) => hostEintrag(h, netzVon.get(h.vlanId)?.name || '', `auf:name:${h.id}`)),
  });

  if (DB.unifi) {
    const fremd = stats.reduce((n, s) => n + (s.fremd || 0), 0);
    liste.push({
      titel: t('Online, aber nicht dokumentiert'),
      erklaerung: t('Laut UniFi aktiv, hier nirgends erfasst. Im Raster schraffiert, übernehmen über «UniFi».'),
      eintraege: fremd ? [{ unifi: true, text: tn(fremd, '1 Adresse — Abgleich öffnen', '{n} Adressen — Abgleich öffnen') }] : [],
      anzahl: fremd,
    });
  }
  // Ausgeblendetes herausnehmen und zählen
  let ausgeblendet = 0;
  for (const c of liste) {
    const vorher = c.eintraege.length;
    c.eintraege = c.eintraege.filter((e) => !e.ign || !aus.has(e.ign));
    ausgeblendet += vorher - c.eintraege.length;
  }
  liste.ausgeblendet = ausgeblendet;
  return liste;
}

// Belegung eines Netzes in seiner Farbe, der Rest als freies Segment.
function belegBalken(s) {
  const p = s.nutzbar ? Math.min(100, (s.hosts.length / s.nutzbar) * 100) : 0;
  const titel = TYPEN.map((typ) => `${typ.label} ${s.typ[typ.kind]}`).join(' · ');
  return `<span class="bar" style="${netzStil(s.v)}" role="img" aria-label="${esc(t('{n} von {gesamt} belegt: {typen}', { n: s.hosts.length, gesamt: s.nutzbar, typen: titel }))}" title="${esc(titel)}">${
    s.hosts.length ? `<span class="seg seg-netz" style="width:${p}%"></span>` : ''}${p < 100 ? '<span class="seg seg-frei"></span>' : ''}</span>`;
}

// Aufteilung nach Typ als Zahlen.
function typZahlen(typ, gesamt) {
  return `<div class="ov-typen">${TYPEN.map((ty) => `<div class="ov-typ">
    <div class="ov-typ-num">${zahl(typ[ty.kind])} <span class="dim">${prozent(typ[ty.kind], gesamt)} %</span></div>
    <div class="ov-typ-label"><i class="typ-mark ${ty.kind === 'reserviert' ? 'res' : ty.kind === 'dhcp' ? 'dhcp' : ''}" aria-hidden="true"></i>${esc(ty.label)}</div>
    <div class="ov-typ-text">${esc(ty.text)}</div></div>`).join('')}</div>`;
}

// Netze und Hosts je Sicherheitszone. Erscheint erst, wenn Zonen gepflegt sind.
function zonenUebersicht(stats) {
  if (!stats.some((s) => s.v.zone) && !(DB.zones || []).length) return '';
  const zonen = new Map((DB.zones || []).map((z) => [z.name, { netze: [], hosts: 0 }]));
  for (const s of stats) {
    const z = zoneVon(s.v.zone)?.name || '';
    const e = zonen.get(z) || { netze: [], hosts: 0 };
    e.netze.push(s.v);
    e.hosts += s.hosts.length;
    zonen.set(z, e);
  }
  const reihenfolge = [...zonen.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
  return `<div class="section-head"><h2>${esc(t('Sicherheitszonen'))}</h2><span class="count">${zahl(reihenfolge.filter(Boolean).length)}</span>
      <button class="btn small section-action" id="zonenVerwalten">${esc(darfSchreiben() ? t('Verwalten') : t('Anzeigen'))}</button></div>
    <div class="ov-zones">${reihenfolge.map((z) => {
    const e = zonen.get(z);
    const zone = zoneVon(z);
    return `<div class="ov-zone${z ? '' : ' ov-zone-leer'}" style="${zone ? farbStil(zone.color) : ''}">
        <div class="ov-zone-name">${esc(z || t('ohne Zone'))}</div>
        <div class="ov-zone-zahlen">${esc(tn(e.netze.length, '1 Netz', '{n} Netze'))} · ${esc(tn(e.hosts, '1 Host', '{n} Hosts', { n: zahl(e.hosts) }))}</div>
        ${zone && zone.beschreibung ? `<div class="ov-zone-zahlen">${esc(zone.beschreibung)}</div>` : ''}
        <div class="ov-zone-netze">${e.netze.map((v) => `<button class="row-link" data-vlanjump="${esc(v.id)}">${esc(v.vid)} ${esc(v.name)}</button>`).join(' · ')}</div>
      </div>`;
  }).join('')}</div>`;
}

function renderOverview(main) {
  const stats = sortedVlans().map(netzStatistik);
  const ipv4 = stats.filter((s) => s.r);
  const nutzbar = ipv4.reduce((n, s) => n + s.nutzbar, 0);
  const erfasstV4 = ipv4.reduce((n, s) => n + s.hosts.length, 0);
  const frei = ipv4.reduce((n, s) => n + s.frei, 0);
  const typ = { statisch: 0, dhcp: 0, reserviert: 0 };
  for (const h of DB.hosts) typ[h.kind in typ ? h.kind : 'statisch']++;
  const checks = auffaelligkeiten(stats);
  const offen = checks.reduce((n, c) => n + (c.anzahl ?? c.eintraege.length), 0);
  const onlineDok = DB.unifi ? stats.reduce((n, s) => n + (s.online || 0), 0) : 0;
  const onlineFremd = DB.unifi ? stats.reduce((n, s) => n + (s.fremd || 0), 0) : 0;

  const tile = (wert, label, sub = '', cls = '') =>
    `<div class="ov-tile ${cls}"><div class="ov-num">${wert}</div><div class="ov-label">${label}</div>${sub ? `<div class="ov-sub">${sub}</div>` : ''}</div>`;

  const neueste = [
    ...DB.hosts.map((h) => ({ at: h.updatedAt || h.createdAt, host: h.id, titel: h.ip, text: h.hostname || t('ohne Namen'), netz: DB.vlans.find((v) => v.id === h.vlanId)?.name || '' })),
    ...DB.vlans.map((v) => ({ at: v.updatedAt || v.createdAt, vlan: v.id, titel: v.cidr, text: v.name, netz: `VLAN ${v.vid}` })),
  ].filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);

  const link = (e) => e.host ? `data-host="${esc(e.host)}"` : e.vlan ? `data-vlanjump="${esc(e.vlan)}"` : 'data-unifi="1"';

  main.innerHTML = `
    <div class="detail-head"><div>
      <h1>${esc(t('Übersicht'))}</h1>
      <div class="detail-sub"><span>${esc(tn(DB.vlans.length, '1 Netz', '{n} Netze', { n: zahl(DB.vlans.length) }))}</span><span>${esc(tn(DB.hosts.length, '1 Eintrag', '{n} Einträge', { n: zahl(DB.hosts.length) }))}</span><span>${esc(DB.domain)}</span></div>
    </div></div>

    <div class="ov-tiles">
      ${tile(zahl(DB.vlans.length), t('Netze'), ipv4.length < stats.length ? t('{n} davon IPv6', { n: stats.length - ipv4.length }) : '')}
      ${tile(zahl(DB.hosts.length), t('Adressen erfasst'), nutzbar ? t('{p} % von {n} nutzbaren', { p: prozent(erfasstV4, nutzbar), n: zahl(nutzbar) }) : '')}
      ${tile(zahl(frei), t('Adressen frei'), t('in IPv4-Netzen'))}
      ${DB.unifi ? tile(zahl(onlineDok + onlineFremd), t('Online laut UniFi'), onlineFremd ? t('{n} davon nicht dokumentiert', { n: zahl(onlineFremd) }) : t('alle dokumentiert')) : ''}
      ${tile(zahl(offen), t('Auffälligkeiten'), offen ? t('siehe unten') : t('alles sauber'), offen ? 'ov-warn' : 'ov-ok')}
    </div>

    <div class="section-head"><h2>${esc(t('Belegung nach Typ'))}</h2><span class="count">${zahl(DB.hosts.length)}</span></div>
    ${DB.hosts.length ? typZahlen(typ, DB.hosts.length)
    : `<p class="purpose">${esc(t('Noch keine Hosts erfasst.'))}</p>`}

    ${zonenUebersicht(stats)}

    <div class="section-head"><h2>${esc(t('Netze'))}</h2><span class="count">${zahl(stats.length)}</span></div>
    <div class="table-wrap"><table class="ov-table"><thead><tr>
      <th>VLAN</th><th>${esc(t('Name'))}</th><th>${esc(t('Subnetz'))}</th><th>${esc(t('Zone'))}</th><th class="ov-bar-col">${esc(t('Belegung'))}</th>
      <th class="num">${esc(t('erfasst'))}</th><th class="num">${esc(t('frei'))}</th><th class="num">${esc(t('DHCP-Bereich'))}</th>
      ${DB.unifi ? `<th class="num">${esc(t('online'))}</th>` : ''}<th>${esc(t('nächste freie'))}</th>
    </tr></thead><tbody>
    ${stats.map((s) => {
    const p = s.r ? prozent(s.hosts.length, s.nutzbar) : null;
    const voll = p !== null && p >= 90;
    return `<tr>
        <td class="ip"><button class="row-link" data-vlanjump="${esc(s.v.id)}"><span class="vid" style="${netzStil(s.v)}">${esc(s.v.vid)}</span></button></td>
        <td><button class="row-link" data-vlanjump="${esc(s.v.id)}">${esc(s.v.name)}</button></td>
        <td class="fq">${esc(s.v.cidr)}</td>
        <td>${s.v.zone ? esc(s.v.zone) : '<span class="dash">–</span>'}</td>
        <td class="ov-bar-col">${s.r
    ? `<div class="ov-bar-wrap">${belegBalken(s)}<span class="ov-pct">${p} %${voll ? ` <span class="ov-flag">${esc(t('fast voll'))}</span>` : ''}</span></div>`
    : '<span class="dash">IPv6</span>'}</td>
        <td class="num">${zahl(s.hosts.length)}</td>
        <td class="num">${s.frei === null ? '<span class="dash">–</span>' : zahl(s.frei)}</td>
        <td class="num">${s.pool ? zahl(s.pool) : '<span class="dash">–</span>'}</td>
        ${DB.unifi ? `<td class="num">${s.online === null ? '<span class="dash">–</span>' : zahl(s.online)}${s.fremd ? ` <span class="ov-flag" title="${esc(t('online, nicht dokumentiert'))}">+${zahl(s.fremd)}</span>` : ''}</td>` : ''}
        <td class="fq">${s.naechste ? esc(s.naechste) : '<span class="dash">–</span>'}</td>
      </tr>`;
  }).join('')}
    </tbody></table></div>
    <p class="ov-note">${esc(t('Belegung: Anteil erfasster Adressen an den nutzbaren, in der Farbe des Netzes — die Aufteilung nach Typ zeigt der Hinweis beim Darüberfahren. «nächste freie» liegt ausserhalb des DHCP-Bereichs und ist nicht das Gateway.'))}</p>

    <div class="ov-cols">
      <section>
        <div class="section-head"><h2>${esc(t('Auffälligkeiten'))}</h2><span class="count">${zahl(offen)}</span></div>
        ${offen ? checks.filter((c) => (c.anzahl ?? c.eintraege.length) > 0).map((c) => `
          <div class="ov-check">
            <div class="ov-check-head"><span class="ov-check-mark" aria-hidden="true">!</span>${esc(c.titel)}<span class="count">${zahl(c.anzahl ?? c.eintraege.length)}</span></div>
            ${c.erklaerung ? `<p class="ov-check-text">${esc(c.erklaerung)}</p>` : ''}
            <ul>${c.eintraege.slice(0, 6).map((e, i, alle) => `<li><button class="row-link" ${link(e)}>${esc(e.text)}</button>${
    e.ign && darfSchreiben() && alle.findIndex((x) => x.ign === e.ign) === i
      ? ` <button class="ov-ign" data-ign="${esc(e.ign)}" data-name="${esc(e.text)}" title="${esc(t('Bewusst so belassen'))}">${esc(t('ausblenden'))}</button>` : ''}</li>`).join('')}
            ${c.eintraege.length > 6 ? `<li class="dim">${esc(t('… und {n} weitere', { n: c.eintraege.length - 6 }))}</li>` : ''}</ul>
          </div>`).join('')
    : `<p class="purpose"><span class="ov-ok-mark" aria-hidden="true">✓</span> ${esc(t('Keine Auffälligkeiten gefunden.'))}</p>`}
        ${checks.ausgeblendet ? `<p class="ov-note">${esc(tn(checks.ausgeblendet, '1 Eintrag ausgeblendet.', '{n} Einträge ausgeblendet.'))}
          ${darfSchreiben() ? `<button class="row-link" id="aufEinblenden">${esc(t('Wieder einblenden'))}</button>` : ''}</p>` : ''}
      </section>

      <section>
        <div class="section-head"><h2>${esc(t('Zuletzt geändert'))}</h2></div>
        ${neueste.length ? `<ul class="ov-recent">${neueste.map((e) => `<li>
          <button class="row-link" ${link(e)}>${esc(e.titel)}</button>
          <span class="ov-recent-name">${esc(e.text)}</span>
          <span class="dim">${esc(e.netz)} · ${esc(vorZeit(e.at))}</span></li>`).join('')}</ul>`
    : `<p class="purpose">${esc(t('Noch nichts erfasst.'))}</p>`}
      </section>
    </div>`;

  wireRows();
  main.querySelectorAll('[data-vlanjump]').forEach((el) => {
    el.onclick = () => { selectedId = el.dataset.vlanjump; $('main').scrollTop = 0; render(); };
  });
  main.querySelectorAll('[data-unifi]').forEach((el) => { el.onclick = () => unifiDrawer(); });
  if ($('zonenVerwalten')) $('zonenVerwalten').onclick = () => zonenDrawer();
  main.querySelectorAll('[data-ign]').forEach((el) => {
    el.onclick = async () => {
      try {
        await call('POST', '/api/ignore', { key: el.dataset.ign, name: el.dataset.name });
        await reload();
        toast(t('Hinweis ausgeblendet'));
      } catch (e) { toast(e.message); }
    };
  });
  if ($('aufEinblenden')) {
    $('aufEinblenden').onclick = async () => {
      try {
        await call('DELETE', '/api/ignore?art=auf');
        await reload();
      } catch (e) { toast(e.message); }
    };
  }
}

/* ---------- Security zones ---------- */

// Zone management in a drawer: list, create, edit, delete. Zones from UniFi keep their name
// (owned by the controller); colour and description are always editable.
function zonenDrawer(ansicht = null) {
  const zonen = (DB.zones || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const netzeVon = (z) => DB.vlans.filter((v) => (v.zone || '').toLowerCase() === z.name.toLowerCase());
  const titel = t('Sicherheitszonen');

  if (ansicht === null) {
    openDrawer(titel, `
      <p class="account-note">${esc(t('Netze tragen die Farbe ihrer Zone. Zonen aus UniFi werden automatisch angelegt; eigene Zonen lassen sich frei anlegen.'))}</p>
      ${zonen.length ? `<ul class="zone-admin">${zonen.map((z) => {
        const n = netzeVon(z).length;
        return `<li>
          <span class="zone-chip" style="${farbStil(z.color)}" aria-hidden="true"></span>
          <span class="zone-admin-main">
            <span class="zone-admin-name">${esc(z.name)} ${z.quelle === 'unifi' ? `<span class="tag">${esc(t('aus UniFi'))}</span>` : ''}</span>
            <span class="zone-admin-meta">${esc(tn(n, '1 Netz', '{n} Netze'))}${z.beschreibung ? ` · ${esc(z.beschreibung)}` : ''}</span>
          </span>
          ${darfSchreiben() ? `<button class="btn small" data-zone="${esc(z.id)}">${esc(t('Bearbeiten'))}</button>` : ''}
        </li>`;
      }).join('')}</ul>` : `<p class="sync-empty">${esc(t('Noch keine Zonen.'))}</p>`}
      <div class="drawer-actions">
        ${darfSchreiben() ? `<button class="btn primary" id="zoneNeu">${esc(t('Zone anlegen'))}</button>` : ''}
        <button class="btn ghost" id="cancel">${esc(t('Schliessen'))}</button>
      </div>`);
    $('cancel').onclick = closeDrawer;
    if ($('zoneNeu')) $('zoneNeu').onclick = () => zonenDrawer('neu');
    $('drawerBody').querySelectorAll('[data-zone]').forEach((el) => { el.onclick = () => zonenDrawer(el.dataset.zone); });
    return;
  }

  const z = ansicht === 'neu' ? null : zonen.find((x) => x.id === ansicht);
  if (ansicht !== 'neu' && !z) return zonenDrawer();
  const ausUnifi = z && z.quelle === 'unifi';
  const anzahl = (p) => zonen.filter((x) => x.color === p).length;
  const farbe = z ? z.color : PALETTE.reduce((best, p) => (anzahl(p) < anzahl(best) ? p : best));
  const n = z ? netzeVon(z).length : 0;

  openDrawer(z ? t('Zone bearbeiten') : t('Zone anlegen'), `
    <div class="field"><label for="z-name">${esc(t('Name'))}</label>
      <input id="z-name" value="${esc(z ? z.name : '')}" maxlength="40" autocomplete="off" ${ausUnifi ? 'disabled' : ''}>
      ${ausUnifi ? `<div class="hint seen">${esc(t('Der Name kommt aus UniFi und wird dort geändert.'))}</div>` : ''}</div>
    <div class="field"><label>${esc(t('Farbe'))}</label>
      <div class="swatches" id="z-palette">${PALETTE.map((p) =>
        `<button type="button" class="swatch ${p === farbe ? 'on' : ''}" data-farbe="${p}" style="${farbStil(p)};background:var(--dot)" aria-label="${esc(PALETTE_LABEL[p])}" title="${esc(PALETTE_LABEL[p])}"></button>`).join('')}
        <label class="swatch swatch-eigen ${HEX_RE.test(farbe) ? 'on' : ''}" title="${esc(t('Eigene Farbe'))}">
          <input type="color" id="z-eigen" value="${HEX_RE.test(farbe) ? esc(farbe.toLowerCase()) : '#336699'}" aria-label="${esc(t('Eigene Farbe'))}">
        </label>
      </div>
      <input type="hidden" id="z-farbe" value="${esc(farbe)}">
      <div class="hint">${esc(t('Die sieben Farben sind auf Unterscheidbarkeit geprüft, hell wie dunkel. Eigene Farben gehen auch — die Schrift darauf passt sich an.'))}</div></div>
    <div class="field"><label for="z-beschreibung">${esc(t('Beschreibung'))}</label>
      <input id="z-beschreibung" value="${esc(z ? z.beschreibung : '')}" maxlength="120" placeholder="${esc(t('z. B. exponierte Dienste'))}"></div>
    ${z ? `<p class="account-note">${esc(tn(n, 'Gilt für 1 Netz.', 'Gilt für {n} Netze.'))}</p>` : ''}
    <div class="form-error" role="alert"></div>
    <div class="drawer-actions">
      <button class="btn primary" id="save">${esc(t('Speichern'))}</button>
      <button class="btn ghost" id="back">${esc(t('Zurück'))}</button>
      ${z && !ausUnifi ? `<button class="btn destructive" id="del">${esc(t('Zone löschen'))}</button>` : ''}
    </div>`);

  const body = $('drawerBody');
  const waehlen = (wert) => {
    $('z-farbe').value = wert;
    body.querySelectorAll('#z-palette .swatch').forEach((s) => s.classList.toggle('on', s.dataset.farbe === wert));
    body.querySelector('.swatch-eigen').classList.toggle('on', HEX_RE.test(wert));
  };
  body.querySelectorAll('[data-farbe]').forEach((s) => { s.onclick = () => waehlen(s.dataset.farbe); });
  $('z-eigen').addEventListener('input', (e) => waehlen(e.target.value.toUpperCase()));
  $('back').onclick = () => zonenDrawer();
  $('save').onclick = async () => {
    const daten = { name: $('z-name').value.trim(), color: $('z-farbe').value, beschreibung: $('z-beschreibung').value.trim() };
    if (!ausUnifi && !daten.name) return showErr(t('Name der Zone fehlt'));
    try {
      if (z) await call('PATCH', `/api/zones/${encodeURIComponent(z.id)}`, daten);
      else await call('POST', '/api/zones', daten);
      await reload();
      toast(z ? t('Zone gespeichert') : t('Zone angelegt'));
      zonenDrawer();
    } catch (e) { showErr(e.message); }
  };
  if ($('del')) {
    $('del').onclick = async () => {
      const frage = n
        ? t('Zone «{zone}» löschen? {n} Netze sind dann ohne Zone und zeigen wieder ihre eigene Farbe.', { zone: z.name, n })
        : t('Zone «{zone}» löschen?', { zone: z.name });
      if (!confirm(frage)) return;
      try {
        await call('DELETE', `/api/zones/${encodeURIComponent(z.id)}`);
        await reload();
        toast(t('Zone gelöscht'));
        zonenDrawer();
      } catch (e) { showErr(e.message); }
    };
  }
}

/* ---------- Suche ---------- */

function renderSearch(main) {
  const q = query.toLowerCase();
  const match = (...f) => f.some((x) => String(x ?? '').toLowerCase().includes(q));

  const hits = DB.hosts.filter((h) => {
    const v = DB.vlans.find((x) => x.id === h.vlanId);
    return match(h.ip, h.hostname, h.fqdn, h.mac, h.role, h.notes, v?.name, v?.cidr, v?.vid, v?.zone);
  }).sort((a, b) => (ipToInt(a.ip) ?? 0) - (ipToInt(b.ip) ?? 0));

  const netHits = sortedVlans().filter((v) => match(v.name, v.cidr, v.purpose, v.notes, v.vid, v.zone));

  main.innerHTML = `<div class="detail-head"><div>
      <h1>${t('Treffer für „{suche}“', { suche: esc(query) })}</h1>
      <div class="detail-sub"><span>${esc(tn(netHits.length, '1 Netz', '{n} Netze'))}</span><span>${esc(tn(hits.length, '1 Host', '{n} Hosts'))}</span></div>
    </div></div>
    ${netHits.length ? `<div class="section-head"><h2>${esc(t('Netze'))}</h2><span class="count">${netHits.length}</span></div>
      <div class="table-wrap"><table><thead><tr><th>VLAN</th><th>${esc(t('Name'))}</th><th>${esc(t('Subnetz'))}</th><th>${esc(t('Zone'))}</th><th class="note">${esc(t('Zweck'))}</th></tr></thead><tbody>
      ${netHits.map((v) => `<tr>
        <td class="ip"><button class="row-link" data-vlanjump="${esc(v.id)}">${esc(v.vid)}</button></td>
        <td>${esc(v.name)}</td><td class="fq">${esc(v.cidr)}</td><td>${esc(v.zone || '')}</td><td class="note">${esc(v.purpose)}</td>
      </tr>`).join('')}</tbody></table></div>` : ''}
    ${hits.length ? `<div class="section-head"><h2>Hosts</h2><span class="count">${hits.length}</span></div>${hostTable(hits, true)}`
      : `<p class="purpose">${esc(t('Keine Hosts gefunden.'))}</p>`}`;

  wireRows();
  main.querySelectorAll('[data-vlanjump]').forEach((el) => {
    el.onclick = () => {
      selectedId = el.dataset.vlanjump;
      $('main').scrollTop = 0;
      query = '';
      $('search').value = '';
      render();
    };
  });
}

/* ---------- Seitenpanel ---------- */

function openDrawer(title, html) {
  if ($('drawer').hidden) lastFocus = document.activeElement;
  $('drawerTitle').textContent = title;
  $('drawerBody').innerHTML = html;
  $('drawer').hidden = false;
  $('scrim').hidden = false;
  const first = $('drawerBody').querySelector('input:not([type=hidden]):not([hidden]), select, textarea');
  if (first) first.focus();
}

function closeDrawer() {
  $('drawer').hidden = true;
  $('scrim').hidden = true;
  $('drawerBody').innerHTML = '';
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

const drawerOpen = () => !$('drawer').hidden;
const val = (name) => $('drawerBody').querySelector(`[name="${name}"]`)?.value.trim() ?? '';

function showErr(msg) {
  const el = $('drawerBody').querySelector('.form-error');
  if (el) el.textContent = msg;
}

function actions(isNew, delLabel) {
  if (!darfSchreiben()) return `<div class="drawer-actions"><button class="btn ghost" id="cancel">${esc(t('Schliessen'))}</button></div>`;
  return `<div class="form-error" role="alert"></div>
    <div class="drawer-actions">
      <button class="btn primary" id="save">${esc(t('Speichern'))}</button>
      <button class="btn ghost" id="cancel">${esc(t('Abbrechen'))}</button>
      ${isNew ? '' : `<button class="btn destructive" id="del">${esc(delLabel)}</button>`}
    </div>`;
}

// Formular schreibgeschützt anzeigen.
// Platzhalter und Eingabehinweise würden hier wie echte Werte wirken und fallen weg.
function nurAnsehen() {
  const body = $('drawerBody');
  body.querySelectorAll('input, select, textarea, .swatch').forEach((el) => {
    el.disabled = true;
    el.removeAttribute('placeholder');
  });
  body.querySelectorAll('.hint:not(.seen)').forEach((el) => el.remove());
  $('cancel').onclick = closeDrawer;
}

/* ---------- Netzformular ---------- */

function zonenFarbHinweis(name) {
  if (!String(name || '').trim()) return '';
  const z = zoneVon(name);
  return z
    ? t('Farbe kommt von der Zone «{zone}» — änderbar unter «Zonen verwalten».', { zone: z.name })
    : t('Die Zone «{zone}» wird beim Speichern angelegt.', { zone: String(name).trim() });
}

function vlanForm(vlan) {
  const isNew = !vlan;
  const v = vlan || { vid: '', name: '', cidr: '', gateway: '', dhcpFrom: '', dhcpTo: '', color: 'blau', zone: '', purpose: '', notes: '' };
  const color = v.color === 'orange' ? 'kupferton' : v.color;

  openDrawer(!darfSchreiben() ? t('Netz') : isNew ? t('Netz anlegen') : t('Netz bearbeiten'), `
    <div class="field-row">
      <div class="field" style="max-width:100px"><label for="f-vid">${esc(t('VLAN-ID'))}</label>
        <input id="f-vid" name="vid" inputmode="numeric" value="${esc(v.vid)}"></div>
      <div class="field"><label for="f-name">${esc(t('Name'))}</label>
        <input id="f-name" name="name" value="${esc(v.name)}" placeholder="Server"></div>
    </div>
    <div class="field"><label for="f-cidr">${esc(t('Subnetz'))}</label>
      <input id="f-cidr" name="cidr" value="${esc(v.cidr)}" placeholder="10.13.37.0/24">
      <div class="hint">${esc(t('CIDR-Schreibweise. IPv6 wird gespeichert, aber ohne Raster dargestellt.'))}</div></div>
    <div class="field"><label for="f-gw">Gateway</label>
      <input id="f-gw" name="gateway" value="${esc(v.gateway)}" placeholder="10.13.37.1"></div>
    <div class="field-row">
      <div class="field"><label for="f-df">${esc(t('DHCP von'))}</label>
        <input id="f-df" name="dhcpFrom" value="${esc(v.dhcpFrom)}"></div>
      <div class="field"><label for="f-dt">${esc(t('DHCP bis'))}</label>
        <input id="f-dt" name="dhcpTo" value="${esc(v.dhcpTo)}"></div>
    </div>
    <div class="field"><label for="f-zone">${esc(t('Sicherheitszone'))}
        <button type="button" class="row-link label-link" id="f-zonen">${esc(t('Zonen verwalten'))}</button></label>
      <input id="f-zone" name="zone" list="zonen" value="${esc(v.zone || '')}" placeholder="${esc(t('z. B. Internal'))}" autocomplete="off" ${v.zoneAusUnifi ? 'disabled' : ''}>
      <datalist id="zonen">${zonenVorschlaege().map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
      <div class="hint seen">${esc(v.zoneAusUnifi
    ? t('Aus UniFi — wird automatisch übernommen. Ändern in der zonenbasierten Firewall von UniFi.')
    : DB.unifi ? t('UniFi kennt dieses Netz nicht oder liefert keine Zone, deshalb von Hand.') : t('Zone der Firewall, etwa aus UniFi.'))}</div></div>
    <div class="field" id="farbFeld" ${v.zone ? 'hidden' : ''}><label>${esc(t('Farbe'))}</label>
      <div class="swatches">${COLORS.map((c) =>
        `<button type="button" class="swatch ${c === color ? 'on' : ''}" data-color="${c}" style="background:var(--${c})" aria-label="${esc(farbName(c))}"></button>`).join('')}</div>
      <input type="hidden" name="color" value="${esc(color)}">
      <div class="hint">${esc(t('Nur für Netze ohne Zone — mit Zone gilt die Farbe der Zone.'))}</div></div>
    <div class="hint seen zone-farbe-hinweis" id="farbHinweis">${esc(zonenFarbHinweis(v.zone))}</div>
    <div class="field"><label for="f-purpose">${esc(t('Zweck'))}</label>
      <input id="f-purpose" name="purpose" value="${esc(v.purpose)}" placeholder="${esc(t('Kameras, isoliert'))}"></div>
    <div class="field"><label for="f-notes">${esc(t('Notizen'))}</label>
      <textarea id="f-notes" name="notes" placeholder="${esc(t('Warum diese Adresse? Was steckt dahinter?'))}">${esc(v.notes)}</textarea></div>
    ${actions(isNew, t('Netz löschen'))}`);

  if (!darfSchreiben()) return nurAnsehen();
  const body = $('drawerBody');
  // With a zone the colour comes from the zone; the network's own colour only without one.
  const farbeNachZone = () => {
    const z = $('f-zone').value.trim();
    $('farbFeld').hidden = Boolean(z);
    $('farbHinweis').textContent = zonenFarbHinweis(z);
  };
  $('f-zone').addEventListener('input', farbeNachZone);
  $('f-zonen').onclick = () => zonenDrawer();
  body.querySelectorAll('.swatch').forEach((s) => {
    s.onclick = () => {
      body.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
      s.classList.add('on');
      body.querySelector('[name="color"]').value = s.dataset.color;
    };
  });

  $('cancel').onclick = closeDrawer;
  $('save').onclick = async () => {
    const p = {
      vid: val('vid'), name: val('name'), cidr: val('cidr'), gateway: val('gateway'),
      dhcpFrom: val('dhcpFrom'), dhcpTo: val('dhcpTo'), color: val('color'), zone: val('zone'),
      purpose: val('purpose'), notes: val('notes'),
    };

    if (!p.name) return showErr(t('Name fehlt'));
    if (!p.cidr) return showErr(t('Subnetz fehlt'));
    if (p.vid !== '' && !/^\d{1,4}$/.test(p.vid)) return showErr(t('VLAN-ID muss eine Zahl von 0 bis 4094 sein'));
    if (p.vid !== '' && Number(p.vid) > 4094) return showErr(t('VLAN-ID muss eine Zahl von 0 bis 4094 sein'));

    const r = parseCidr(p.cidr);
    if (!r && !isIpv6ish(p.cidr)) return showErr(t('Subnetz muss CIDR sein, etwa 10.13.37.0/24'));

    const inside = (n) => !r || (n >= r.net && n <= r.bcast);
    for (const [key, label] of [['gateway', 'Gateway'], ['dhcpFrom', t('DHCP von')], ['dhcpTo', t('DHCP bis')]]) {
      if (!p[key]) continue;
      const n = ipToInt(p[key]);
      if (r && n === null) return showErr(t('{feld} ist keine gültige IPv4-Adresse', { feld: label }));
      if (n !== null && !inside(n)) return showErr(t('{feld} liegt ausserhalb von {cidr}', { feld: label, cidr: p.cidr }));
    }
    if (!!p.dhcpFrom !== !!p.dhcpTo) return showErr(t('DHCP-Bereich braucht Anfang und Ende'));
    if (p.dhcpFrom && p.dhcpTo && ipToInt(p.dhcpFrom) > ipToInt(p.dhcpTo)) return showErr(t('DHCP-Bereich läuft rückwärts'));

    const dupe = DB.vlans.find((x) => x.id !== v.id && x.cidr === p.cidr);
    if (dupe) return showErr(t('{cidr} ist schon bei „{name}“ hinterlegt', { cidr: p.cidr, name: dupe.name }));

    try {
      const saved = isNew ? await call('POST', '/api/vlans', p) : await call('PATCH', `/api/vlans/${encodeURIComponent(v.id)}`, p);
      selectedId = saved.id;
      closeDrawer();
      await reload();
      toast(isNew ? t('Netz angelegt') : t('Netz gespeichert'));
    } catch (e) { showErr(e.message); }
  };

  if (!isNew) {
    $('del').onclick = async () => {
      const n = DB.hosts.filter((h) => h.vlanId === v.id).length;
      const q = n
        ? tn(n, '„{name}“ löschen? 1 zugehöriger Host wird mitgelöscht.', '„{name}“ löschen? {n} zugehörige Hosts werden mitgelöscht.', { name: v.name })
        : t('„{name}“ löschen?', { name: v.name });
      if (!confirm(q)) return;
      try {
        await call('DELETE', `/api/vlans/${encodeURIComponent(v.id)}`);
        selectedId = null;
        closeDrawer();
        await reload();
        toast(t('Netz gelöscht'));
      } catch (e) { showErr(e.message); }
    };
  }
}

/* ---------- Hostformular ---------- */

// «zuletzt gesehen» laut UniFi, sofern die MAC dort bekannt ist.
function zuletztText(h) {
  if (!DB.unifi || !h.mac) return '';
  const mac = h.mac.toLowerCase().replace(/-/g, ':');
  if ([...LIVE.values()].some((l) => l.mac === mac)) return esc(t('Laut UniFi gerade online'));
  const zuletzt = ZULETZT[mac];
  return esc(zuletzt ? t('Laut UniFi zuletzt gesehen {zeit}', { zeit: vorZeit(new Date(zuletzt).toISOString()) }) : t('UniFi kennt diese MAC nicht'));
}

function hostForm(host) {
  if (!host) return;
  const isNew = !host.id;
  const h = host;

  openDrawer(!darfSchreiben() ? t('Host') : isNew ? t('Host hinzufügen') : t('Host bearbeiten'), `
    <div class="field"><label for="h-vlan">${esc(t('Netz'))}</label>
      <select id="h-vlan" name="vlanId">${sortedVlans().map((v) =>
        `<option value="${esc(v.id)}" ${v.id === h.vlanId ? 'selected' : ''}>${esc(v.vid)} · ${esc(v.name)} (${esc(v.cidr)})</option>`).join('')}</select></div>
    <div class="field"><label for="h-ip">${esc(t('Adresse'))}</label>
      <input id="h-ip" name="ip" value="${esc(h.ip)}" placeholder="10.13.37.10"></div>
    <div class="field"><label for="h-name">Hostname</label>
      <input id="h-name" name="hostname" value="${esc(h.hostname)}" placeholder="0r4cl3"></div>
    <div class="field"><label for="h-fqdn">${esc(t('DNS-Name'))}</label>
      <input id="h-fqdn" name="fqdn" value="${esc(h.fqdn)}" placeholder="0r4cl3.${esc(DB.domain)}">
      <div class="hint">${esc(t('Leer lassen ergänzt automatisch .{domain}', { domain: DB.domain }))}</div></div>
    <div class="field-row">
      <div class="field"><label for="h-mac">MAC</label>
        <input id="h-mac" name="mac" value="${esc(h.mac)}" placeholder="aa:bb:cc:dd:ee:ff"></div>
      <div class="field" style="max-width:132px"><label for="h-kind">${esc(t('Typ'))}</label>
        <select id="h-kind" name="kind">${KINDS.map((k) =>
          `<option value="${k}" ${k === (h.kind || 'statisch') ? 'selected' : ''}>${esc(kindLabel(k))}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="h-role">${esc(t('Rolle'))}</label>
      <input id="h-role" name="role" value="${esc(h.role)}" placeholder="${esc(t('DNS-Container'))}"></div>
    <div class="field"><label class="check"><input type="checkbox" id="h-spor" ${h.sporadisch ? 'checked' : ''}> ${esc(t('Meldet sich nur sporadisch'))}</label>
      <div class="hint">${esc(t('Etwa Batteriegeräte, die das WLAN nur kurz nutzen. Wird nie als offline entfernt.'))}</div>
      ${zuletztText(h) ? `<div class="hint seen">${zuletztText(h)}</div>` : ''}</div>
    <div class="field"><label for="h-notes">${esc(t('Notizen'))}</label>
      <textarea id="h-notes" name="notes">${esc(h.notes)}</textarea></div>
    ${actions(isNew, t('Host löschen'))}`);

  if (!darfSchreiben()) return nurAnsehen();
  const nameEl = $('h-name');
  const fqdnEl = $('h-fqdn');
  // Ein bereits gesetzter DNS-Name gilt als bewusst gewählt und wird nicht überschrieben.
  if (h.fqdn) fqdnEl.dataset.touched = '1';
  nameEl.addEventListener('input', () => {
    if (!fqdnEl.dataset.touched) fqdnEl.value = nameEl.value ? `${nameEl.value}.${DB.domain}` : '';
  });
  fqdnEl.addEventListener('input', () => { fqdnEl.dataset.touched = '1'; });

  $('cancel').onclick = closeDrawer;
  $('save').onclick = async () => {
    const p = {
      vlanId: val('vlanId'), ip: val('ip'), hostname: val('hostname'), fqdn: val('fqdn'),
      mac: val('mac'), kind: val('kind'), role: val('role'), notes: val('notes'), sporadisch: $('h-spor').checked,
    };
    if (!p.fqdn && p.hostname) p.fqdn = `${p.hostname}.${DB.domain}`;

    if (!p.vlanId) return showErr(t('Netz fehlt'));
    if (!p.ip) return showErr(t('Adresse fehlt'));

    const vlan = DB.vlans.find((x) => x.id === p.vlanId);
    const r = vlan ? parseCidr(vlan.cidr) : null;
    const n = ipToInt(p.ip);

    if (r) {
      if (n === null) return showErr(t('Keine gültige IPv4-Adresse'));
      if (n < r.net || n > r.bcast) return showErr(t('{feld} liegt ausserhalb von {cidr}', { feld: p.ip, cidr: vlan.cidr }));
      if (r.size > 2 && n === r.net) return showErr(t('Das ist die Netzadresse'));
      if (r.size > 2 && n === r.bcast) return showErr(t('Das ist die Broadcast-Adresse'));
    }
    if (p.mac && !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(p.mac)) return showErr(t('MAC-Adresse hat ein ungültiges Format'));

    const clash = DB.hosts.find((x) => x.vlanId === p.vlanId && x.ip === p.ip && x.id !== h.id);
    if (clash) return showErr(t('{ip} ist bereits vergeben: {name}', { ip: p.ip, name: clash.hostname || clash.fqdn || t('unbenannt') }));

    try {
      if (isNew) await call('POST', '/api/hosts', p);
      else await call('PATCH', `/api/hosts/${encodeURIComponent(h.id)}`, p);
      selectedId = p.vlanId;
      closeDrawer();
      await reload();
      toast(isNew ? t('Host hinzugefügt') : t('Host gespeichert'));
    } catch (e) { showErr(e.message); }
  };

  if (!isNew) {
    $('del').onclick = async () => {
      if (!confirm(t('{ip} löschen?', { ip: h.ip }))) return;
      try {
        await call('DELETE', `/api/hosts/${encodeURIComponent(h.id)}`);
        closeDrawer();
        await reload();
        toast(t('Host gelöscht'));
      } catch (e) { showErr(e.message); }
    };
  }
}

/* ---------- Verdrahtung ---------- */

function closeRail() {
  $('rail').classList.remove('open');
  $('railToggle').setAttribute('aria-expanded', 'false');
}

function showOverview(e) {
  if (e) e.preventDefault();
  selectedId = null;
  query = '';
  $('search').value = '';
  $('main').scrollTop = 0;
  closeRail();
  render();
}

$('navOverview').onclick = showOverview;
$('navZonen').onclick = () => { closeRail(); zonenDrawer(); };
$('brand').onclick = showOverview;
$('btnTheme').onclick = cycleTheme;
$('btnSettings').onclick = () => { closeRail(); settingsDrawer(); };
$('btnAccount').onclick = () => { closeRail(); accountDrawer(); };
$('btnUnifi').onclick = () => { closeRail(); unifiDrawer(); };
$('btnNewVlan').onclick = () => { closeRail(); vlanForm(); };
$('drawerClose').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;
$('railToggle').onclick = () => {
  const open = $('rail').classList.toggle('open');
  $('railToggle').setAttribute('aria-expanded', String(open));
};

let searchTimer;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { query = e.target.value.trim(); render(); }, 120);
});

$('btnExport').onclick = () => { window.location.href = '/api/export'; };
$('btnImport').onclick = () => $('fileImport').click();
$('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (confirm(t('Import ersetzt den gesamten Bestand. Vorher wird automatisch eine Sicherung angelegt. Fortfahren?'))) {
    try {
      await call('POST', '/api/import', JSON.parse(await file.text()));
      selectedId = null;
      await reload();
      toast(t('Bestand importiert'));
    } catch (err) { toast(t('Import fehlgeschlagen: {fehler}', { fehler: err.message })); }
  }
  e.target.value = '';
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  const typing = el instanceof HTMLElement &&
    (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

  if (e.key === 'Escape') {
    if (drawerOpen()) return closeDrawer();
    if ($('rail').classList.contains('open')) return closeRail();
    if (typing && el.id === 'search') { el.value = ''; query = ''; render(); el.blur(); }
    return;
  }
  // Der Schrägstrich darf beim Tippen von CIDR-Notation nicht ins Suchfeld springen.
  if (e.key === '/' && !typing && !drawerOpen()) {
    e.preventDefault();
    $('search').focus();
  }
});

/* ---------- Sprache ---------- */

// Feste Texte im HTML übersetzen. Der Knopf zeigt die jeweils andere Sprache;
// nach dem Umschalten wird neu geladen, damit kein Text in der alten Sprache stehen bleibt.
I18N.applyStatic(document);
$('btnLang').textContent = I18N.getLang() === 'de' ? 'EN' : 'DE';
$('btnLang').onclick = () => {
  I18N.setLang(I18N.getLang() === 'de' ? 'en' : 'de');
  window.location.reload();
};

call('GET', '/api/auth/status').then((s) => { AUTH = s; }).catch(() => {})
  .then(() => { applyRolle(); return reload(); })
  .then(loadLive).then(render).catch((e) => {
  $('main').innerHTML = `<div class="empty"><h1>${esc(t('Keine Verbindung zum Dienst'))}</h1><p>${esc(e.message)}</p></div>`;
});
