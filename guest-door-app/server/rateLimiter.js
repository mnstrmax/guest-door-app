// Einfaches In-Memory Rate-Limiting für PIN-Versuche pro IP-Adresse,
// um Brute-Force-Angriffe auf die PIN zu erschweren.

const attempts = new Map(); // ip -> { count, firstAttempt }
const WINDOW_MS = 15 * 60 * 1000; // 15 Minuten
const MAX_ATTEMPTS = 8;

function isRateLimited(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip) {
  const entry = attempts.get(ip);
  if (!entry || Date.now() - entry.firstAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function resetAttempts(ip) {
  attempts.delete(ip);
}

// Zusätzlich zum Pro-IP-Limit ein globales Limit (nicht nach IP getrennt): verhindert,
// dass jemand das IP-Limit einfach durch viele verschiedene Absender-IPs (z.B. Botnetz)
// umgeht. Bei nur 4-stelligen PINs ist das die eigentlich wirksame Bremse gegen
// verteiltes Brute-Forcing - 8 Fehlversuche insgesamt, egal von wo, dann ist für alle
// 15 Minuten Pause. Gleiches Zeitfenster/Schwelle wie das Pro-IP-Limit, bewusst nicht
// konfigurierbar getrennt, um es einfach zu halten.
let globalState = null; // { count, firstAttempt } | null

function isGloballyRateLimited() {
  if (!globalState) return false;
  if (Date.now() - globalState.firstAttempt > WINDOW_MS) {
    globalState = null;
    return false;
  }
  return globalState.count >= MAX_ATTEMPTS;
}

// Gibt zurück, ob dieser Versuch die globale Sperre gerade erst ausgelöst hat (Schwelle
// exakt erreicht) - damit der Aufrufer den Gastgeber genau einmal benachrichtigen kann,
// statt bei jedem weiteren Versuch erneut.
function recordGlobalAttempt() {
  if (!globalState || Date.now() - globalState.firstAttempt > WINDOW_MS) {
    globalState = { count: 1, firstAttempt: Date.now() };
    return false;
  }
  globalState.count += 1;
  return globalState.count === MAX_ATTEMPTS;
}

function resetGlobalAttempts() {
  globalState = null;
}

// Eigener, strengerer Bucket für /admin/login-Versuche (Benutzername+Passwort+TOTP) -
// getrennt vom Gäste-PIN-Limit, da ein erfolgreicher Admin-Login deutlich weitreichender
// ist als eine einzelne Gäste-PIN. Ebenfalls pro IP UND global, aus demselben Grund wie
// beim PIN-Limit (verteiltes Brute-Forcing über viele IPs).
const ADMIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_ATTEMPTS = 5;
const adminAttempts = new Map();
let adminGlobalState = null;

function isAdminLoginRateLimited(ip) {
  const entry = adminAttempts.get(ip);
  const ipLimited = entry && Date.now() - entry.firstAttempt <= ADMIN_WINDOW_MS && entry.count >= ADMIN_MAX_ATTEMPTS;
  if (entry && Date.now() - entry.firstAttempt > ADMIN_WINDOW_MS) adminAttempts.delete(ip);

  if (adminGlobalState && Date.now() - adminGlobalState.firstAttempt > ADMIN_WINDOW_MS) adminGlobalState = null;
  const globalLimited = adminGlobalState && adminGlobalState.count >= ADMIN_MAX_ATTEMPTS;

  return !!ipLimited || !!globalLimited;
}

function recordAdminLoginAttempt(ip) {
  const entry = adminAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAttempt > ADMIN_WINDOW_MS) {
    adminAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count += 1;
  }

  if (!adminGlobalState || Date.now() - adminGlobalState.firstAttempt > ADMIN_WINDOW_MS) {
    adminGlobalState = { count: 1, firstAttempt: Date.now() };
  } else {
    adminGlobalState.count += 1;
  }
}

function resetAdminLoginAttempts(ip) {
  adminAttempts.delete(ip);
  adminGlobalState = null;
}

module.exports = {
  isRateLimited,
  recordAttempt,
  resetAttempts,
  isGloballyRateLimited,
  recordGlobalAttempt,
  resetGlobalAttempts,
  isAdminLoginRateLimited,
  recordAdminLoginAttempt,
  resetAdminLoginAttempts,
};
