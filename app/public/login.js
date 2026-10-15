'use strict';

// Übersetzung. Fehlt i18n.js (etwa weil der Server es vor der Anmeldung nicht ausliefert),
// bleibt die Anmeldung deutsch, funktioniert aber weiter.
const I18 = window.I18N || {
  t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)),
  tr: (s) => s,
  getLang: () => 'de',
  setLang: () => {},
  applyStatic: () => {},
};
const { t, tr } = I18;

const $ = (id) => document.getElementById(id);

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-IPAM-Request': '1' } : { 'X-IPAM-Request': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Meldungen des Servers kommen deutsch und werden hier übersetzt.
  if (!res.ok) throw new Error(data.error ? tr(data.error) : t('Fehler {status}', { status: res.status }));
  return data;
}

function wire(form, submit) {
  const err = form.querySelector('.form-error');
  const btn = form.querySelector('button[type=submit]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      await submit(form.elements);
      window.location.replace('/');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
}

wire($('formLogin'), (f) => {
  if (!f.user.value.trim() || !f.password.value) throw new Error(t('Benutzername und Passwort eingeben'));
  return call('POST', '/api/auth/login', {
    user: f.user.value.trim(), password: f.password.value, remember: f.remember.checked,
  }).catch((e) => { f.password.value = ''; f.password.focus(); throw e; });
});

let minPassword = 12;
wire($('formSetup'), (f) => {
  if (!f.code.value.trim()) throw new Error(t('Einrichtungscode fehlt'));
  if (!f.user.value.trim()) throw new Error(t('Benutzername fehlt'));
  if (f.password.value.length < minPassword) throw new Error(t('Passwort muss mindestens {n} Zeichen lang sein', { n: minPassword }));
  if (f.password.value !== f.password2.value) throw new Error(t('Die beiden Passwörter stimmen nicht überein'));
  return call('POST', '/api/auth/setup', {
    code: f.code.value, user: f.user.value.trim(), password: f.password.value,
  });
});

// Feste Texte übersetzen und Sprachumschalter verdrahten. Umschalten lädt die Seite neu.
I18.applyStatic(document);
if (window.I18N) {
  $('btnLang').hidden = false;
  $('btnLang').textContent = I18.getLang() === 'de' ? 'EN' : 'DE';
  $('btnLang').onclick = () => {
    I18.setLang(I18.getLang() === 'de' ? 'en' : 'de');
    window.location.reload();
  };
}

call('GET', '/api/auth/status').then((s) => {
  if (s.authenticated) return window.location.replace('/');
  minPassword = s.minPassword || minPassword;
  const form = s.mode === 'setup' ? $('formSetup') : $('formLogin');
  form.hidden = false;
  form.querySelector('input').focus();
}).catch((e) => {
  $('loginFoot').textContent = t('Keine Verbindung zum Dienst: {fehler}', { fehler: e.message });
});
