const el = (id) => document.getElementById(id);
const steps = ['step-pin', 'step-bell', 'step-street-open', 'step-apartment', 'step-done'];

function showStep(id) {
  steps.forEach((s) => el(s).classList.toggle('hidden', s !== id));
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
      el('pin-error').textContent = data.error || 'Fehler bei der PIN-Prüfung.';
      return;
    }
    token = data.token;
    sessionStorage.setItem('guestToken', token);
    showStep('step-bell');
    startPolling();
  } catch (err) {
    el('pin-error').textContent = 'Verbindung zum Server fehlgeschlagen.';
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
        resetToPinStep(data.error);
        return;
      }

      el('bell-error').textContent = data.error || '';

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
      el('apartment-error').textContent = data.error || 'Wohnungstür konnte nicht geöffnet werden.';
      el('apartment-btn').disabled = false;
      return;
    }
    sessionStorage.removeItem('guestToken');
    showStep('step-done');
  } catch (err) {
    el('apartment-error').textContent = 'Verbindung zum Server fehlgeschlagen.';
    el('apartment-btn').disabled = false;
  }
});

function resetToPinStep(message) {
  token = null;
  sessionStorage.removeItem('guestToken');
  el('pin-error').textContent = message || '';
  showStep('step-pin');
}

// Falls die Seite neu geladen wurde, aber noch ein gültiges Token existiert: Polling fortsetzen.
if (token) {
  showStep('step-bell');
  startPolling();
}
