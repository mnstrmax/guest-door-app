const crypto = require('crypto');

// Sessions für den Login-geschützten /admin-Bereich (Benutzername + Passwort + optional
// TOTP). Analog zu server/sessions.js (Gäste-Sessions), aber komplett getrennt - eine
// abgelaufene/kompromittierte Admin-Session darf niemals mit einer Gäste-Session
// verwechselt werden können.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 Stunden

const sessions = new Map(); // token -> { createdAt }

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function isValidAdminSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroyAdminSession(token) {
  if (token) sessions.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 15 * 60 * 1000);

module.exports = { createAdminSession, isValidAdminSession, destroyAdminSession };
