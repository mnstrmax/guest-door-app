const el = (id) => document.getElementById(id);
const steps = ['step-pin', 'step-bell', 'step-street-open', 'step-apartment', 'step-done'];

let lang = detectLanguage();
let guestTexts = JSON.parse(sessionStorage.getItem('guestTexts') || 'null');

function t() {
  return TRANSLATIONS[lang];
}

function showStep(id) {
  steps.forEach((s) => el(s).classList.toggle('hidden', s !== id));
}

// Rendert alle statischen + gast-individuellen Texte in der aktuell gewählten Sprache neu.
function render() {
  const T = t();
  document.documentElement.lang = lang;
  el('title').textContent = T.title;
  el('pin-intro').textContent = T.pinIntro;
  el('pin-submit').textContent = T.pinSubmit;
  el('bell-title').textContent = T.bellTitle;
  el('bell-waiting').textContent = T.bellWaiting;
  el('street-open-title').textContent = T.streetOpenTitle;
  el('continue-btn').textContent = T.continueBtn;
  el('apartment-title').textContent = T.apartmentTitle;
  el('apartment-intro').textContent = T.apartmentIntro;
  el('apartment-btn').textContent = T.apartmentBtn;
  el('done-title').textContent = T.doneTitle;
  el('done-footer').textContent = T.doneFooter;

  if (guestTexts) {
    if (guestTexts.guestName) {
      el('guest-greeting').textContent = T.greeting(guestTexts.guestName);
      el('guest-greeting').classList.remove('hidden');
    }
    el('bell-text').textContent = T.bellText(guestTexts.bellLabel);
    el('street-open-text').textContent = T.streetOpenText(guestTexts.apartmentFloor, guestTexts.apartmentSide);
    el('done-text').textContent = T.doneText(guestTexts.roomNumber, guestTexts.roomSide);
  } else {
    el('bell-text').textContent = T.bellText('');
    el('street-open-text').textContent = T.streetOpenText(null, null);
    el('done-text').textContent = T.doneText(null, null);
  }

  document.querySelectorAll('#lang-switcher button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

function setLang(newLang) {
  lang = newLang;
  sessionStorage.setItem('guestLang', lang);
  render();
}

document.querySelectorAll('#lang-switcher button').forEach((btn) => {
  btn.addEventListener('click', () => setLang(btn.dataset.lang));
});

function translateError(data) {
  const T = t();
  if (data && data.code && T.errors[data.code]) return T.errors[data.code];
  return T.errors.generic;
}

let token = sessionStorage.getItem('guestToken') || null;
let pollTimer = null;

el('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('pin-error').textContent = '';
  const pin = el('pin-input').value.trim();

  try {
    const res = await fetch('/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('pin-error').textContent = translateError(data);
      return;
    }
    token = data.token;
    guestTexts = data;
    sessionStorage.setItem('guestToken', token);
    sessionStorage.setItem('guestTexts', JSON.stringify(data));
    render();
    showStep('step-bell');
    startPolling();
  } catch (err) {
    el('pin-error').textContent = t().errors.network;
  }
});

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/session?token=${encodeURIComponent(token)}`);
      const data = await res.json();

      if (!res.ok) {
        clearInterval(pollTimer);
        resetToPinStep(translateError(data));
        return;
      }

      el('bell-error').textContent = data.errorCode ? translateError(data) : '';

      if (data.step === 'street_door_open' || data.step === 'done') {
        clearInterval(pollTimer);
        showStep('step-street-open');
      }
    } catch (err) {
      // kurzer Netzwerk-Hänger, beim nächsten Tick erneut versuchen
    }
  }, 2000);
}

el('continue-btn').addEventListener('click', () => showStep('step-apartment'));

el('apartment-btn').addEventListener('click', async () => {
  el('apartment-error').textContent = '';
  el('apartment-btn').disabled = true;

  try {
    const res = await fetch('/api/open-apartment-door', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('apartment-error').textContent = translateError(data);
      el('apartment-btn').disabled = false;
      return;
    }
    sessionStorage.removeItem('guestToken');
    sessionStorage.removeItem('guestTexts');
    showStep('step-done');
  } catch (err) {
    el('apartment-error').textContent = t().errors.network;
    el('apartment-btn').disabled = false;
  }
});

function resetToPinStep(message) {
  token = null;
  sessionStorage.removeItem('guestToken');
  sessionStorage.removeItem('guestTexts');
  el('pin-error').textContent = message || '';
  showStep('step-pin');
}

render();

// Falls die Seite neu geladen wurde, aber noch ein gültiges Token existiert: Polling fortsetzen.
if (token) {
  showStep('step-bell');
  startPolling();
}
