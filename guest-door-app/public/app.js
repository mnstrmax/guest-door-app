const el = (id) => document.getElementById(id);
const steps = ['step-pin', 'step-bell', 'step-street-open', 'step-apartment', 'step-done', 'step-menu', 'step-controls'];

let lang = detectLanguage();
let guestTexts = JSON.parse(sessionStorage.getItem('guestTexts') || 'null');

function t() {
  return TRANSLATIONS[lang];
}

function showStep(id) {
  steps.forEach((s) => el(s).classList.toggle('hidden', s !== id));
}

// Ordnet einen vom Server gelieferten Session-Schritt dem passenden UI-Step zu.
// "opening" (Klingeln erkannt, Ring-Service wird gerade aufgerufen) zeigt noch den
// Warte-Screen - der Wechsel zu "street-open" kommt dann über das Polling.
function showStepForServerStep(step) {
  if (step === 'menu') return showStep('step-menu');
  if (step === 'street_door_open') return showStep('step-street-open');
  if (step === 'done') return showStep('step-done');
  return showStep('step-bell');
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
  el('confirm-ok-btn').textContent = T.confirmOkBtn;
  el('menu-title').textContent = T.menuTitle;
  el('menu-intro').textContent = T.menuIntro;
  el('menu-doors-btn').textContent = T.menuDoorsBtn;
  el('menu-controls-btn').textContent = T.menuControlsBtn;
  el('controls-title').textContent = T.controlsTitle;
  el('controls-climate-label').textContent = T.controlsClimateLabel;
  el('controls-ceiling-label').textContent = T.controlsCeilingLabel;
  el('controls-floor-label').textContent = T.controlsFloorLabel;
  el('controls-back-btn').textContent = T.controlsBackBtn;
  // Lichtschalter-Beschriftung hängt vom aktuellen An/Aus-Zustand ab (siehe updateLightButton).
  if (el('ceiling-toggle').dataset.on) updateLightButton('ceiling-toggle', el('ceiling-toggle').dataset.on === '1');
  if (el('floor-toggle').dataset.on) updateLightButton('floor-toggle', el('floor-toggle').dataset.on === '1');

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
    showStepForServerStep(data.step);
    if (data.step !== 'menu') startPolling();
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

// "Alles in Ordnung": markiert den Gast serverseitig als eingecheckt (für das
// Rückkehrgast-Menü beim nächsten Login) und benachrichtigt den Gastgeber.
el('confirm-ok-btn').addEventListener('click', async () => {
  el('confirm-ok-btn').disabled = true;
  try {
    const res = await fetch('/api/confirm-ok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('confirm-ok-btn').disabled = false;
      return;
    }
    el('confirm-ok-btn').classList.add('hidden');
    el('confirm-ok-done').textContent = t().confirmOkDone;
    el('confirm-ok-done').classList.remove('hidden');
  } catch (err) {
    el('confirm-ok-btn').disabled = false;
  }
});

// --- Rückkehrgast-Menü ---

el('menu-doors-btn').addEventListener('click', async () => {
  el('menu-error').textContent = '';
  try {
    const res = await fetch('/api/menu/reopen-doors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('menu-error').textContent = translateError(data);
      return;
    }
    showStep('step-bell');
    startPolling();
  } catch (err) {
    el('menu-error').textContent = t().errors.network;
  }
});

el('menu-controls-btn').addEventListener('click', () => {
  showStep('step-controls');
  loadRoomControls();
});

el('controls-back-btn').addEventListener('click', () => showStep('step-menu'));

// --- Zimmersteuerung (Heizung + Lichter) ---

let climateState = null; // { target, min, max }

function renderClimateValue() {
  el('climate-value').textContent = climateState && climateState.target != null ? `${climateState.target}°C` : '–';
}

function updateLightButton(id, on) {
  const btn = el(id);
  btn.textContent = on ? t().lightTurnOffBtn : t().lightTurnOnBtn;
  btn.dataset.on = on ? '1' : '0';
}

async function loadRoomControls() {
  el('controls-error').textContent = '';
  try {
    const res = await fetch(`/api/room-controls?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) {
      el('controls-error').textContent = translateError(data);
      return;
    }

    if (data.climate) {
      climateState = {
        target: data.climate.targetTemperature,
        min: data.climate.minTemp != null ? data.climate.minTemp : 10,
        max: data.climate.maxTemp != null ? data.climate.maxTemp : 28,
      };
      el('controls-climate').classList.remove('hidden');
      renderClimateValue();
    } else {
      climateState = null;
      el('controls-climate').classList.add('hidden');
    }

    if (data.ceilingLight) {
      el('controls-ceiling').classList.remove('hidden');
      updateLightButton('ceiling-toggle', data.ceilingLight.on);
    } else {
      el('controls-ceiling').classList.add('hidden');
    }

    if (data.floorLight) {
      el('controls-floor').classList.remove('hidden');
      updateLightButton('floor-toggle', data.floorLight.on);
    } else {
      el('controls-floor').classList.add('hidden');
    }
  } catch (err) {
    el('controls-error').textContent = t().errors.network;
  }
}

async function adjustClimate(delta) {
  if (!climateState || climateState.target == null) return;
  const next = Math.min(climateState.max, Math.max(climateState.min, Math.round((climateState.target + delta) * 2) / 2));
  const previous = climateState.target;
  climateState.target = next;
  renderClimateValue();
  try {
    const res = await fetch('/api/room-controls/climate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, temperature: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('controls-error').textContent = translateError(data);
      climateState.target = previous;
      renderClimateValue();
    }
  } catch (err) {
    el('controls-error').textContent = t().errors.network;
    climateState.target = previous;
    renderClimateValue();
  }
}

el('climate-plus').addEventListener('click', () => adjustClimate(0.5));
el('climate-minus').addEventListener('click', () => adjustClimate(-0.5));

async function toggleLight(target, btnId) {
  const currentlyOn = el(btnId).dataset.on === '1';
  const nextOn = !currentlyOn;
  updateLightButton(btnId, nextOn); // optimistisch, wird bei Fehler zurückgesetzt
  try {
    const res = await fetch('/api/room-controls/light', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, target, on: nextOn }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('controls-error').textContent = translateError(data);
      updateLightButton(btnId, currentlyOn);
    }
  } catch (err) {
    el('controls-error').textContent = t().errors.network;
    updateLightButton(btnId, currentlyOn);
  }
}

el('ceiling-toggle').addEventListener('click', () => toggleLight('ceiling', 'ceiling-toggle'));
el('floor-toggle').addEventListener('click', () => toggleLight('floor', 'floor-toggle'));

function resetToPinStep(message) {
  token = null;
  sessionStorage.removeItem('guestToken');
  sessionStorage.removeItem('guestTexts');
  el('pin-error').textContent = message || '';
  showStep('step-pin');
}

render();

// Falls die Seite neu geladen wurde, aber noch ein gültiges Token existiert: aktuellen
// Schritt vom Server holen (kann jetzt auch "menu", "street_door_open" oder "done" sein,
// nicht mehr pauschal "wartet auf Klingeln") und ggf. Polling fortsetzen.
if (token) {
  fetch(`/api/session?token=${encodeURIComponent(token)}`)
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        resetToPinStep(translateError(data));
        return;
      }
      showStepForServerStep(data.step);
      if (data.step === 'await_bell' || data.step === 'opening') startPolling();
    })
    .catch(() => resetToPinStep(t().errors.network));
}
