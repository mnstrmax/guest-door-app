const crypto = require('crypto');

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 Stunden
const sessions = new Map();

/**
 * Ablauf einer Session (Feld "step"):
 *   menu               -> Rückkehrgast: Auswahl zwischen "Türen öffnen" und "Zimmer steuern"
 *   await_bell        -> wartet darauf, dass der Gast klingelt
 *   opening            -> Klingeln erkannt, Ring-Intercom-Service wird gerade aufgerufen
 *   street_door_open   -> Haustür wurde geöffnet, Gast darf zur Wohnungstür weitergehen
 *   done               -> Wohnungstür wurde geöffnet
 */
function createSession(guest, initialStep = 'await_bell') {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    token,
    guestId: guest.id,
    guestName: guest.name || 'Gast',
    step: initialStep,
    error: null,
    errorCode: null,
    createdAt: Date.now(),
  });
  return token;
}

function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function updateSession(token, patch) {
  const s = sessions.get(token);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

function sessionsAwaitingBell() {
  return [...sessions.values()].filter((s) => s.step === 'await_bell');
}

// Regelmäßiges Aufräumen abgelaufener Sessions
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 5 * 60 * 1000);

module.exports = { createSession, getSession, updateSession, sessionsAwaitingBell };
