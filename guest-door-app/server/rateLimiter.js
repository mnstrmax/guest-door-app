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

module.exports = {
  isRateLimited,
  recordAttempt,
  resetAttempts,
  isGloballyRateLimited,
  recordGlobalAttempt,
  resetGlobalAttempts,
};
