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

module.exports = { isRateLimited, recordAttempt, resetAttempts };
