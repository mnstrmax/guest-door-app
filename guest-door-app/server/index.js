const path = require('path');
const express = require('express');
const config = require('./config');
const HAClient = require('./haClient');
const { findValidGuest } = require('./guests');
const { createSession, getSession, updateSession, sessionsAwaitingBell } = require('./sessions');
const { isRateLimited, recordAttempt, resetAttempts } = require('./rateLimiter');

console.log(`[app] Starte im Modus: ${config.mode}`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const ha = new HAClient({
  baseUrl: config.haUrl,
  token: config.haToken,
  doorbellEntityId: config.doorbellEntityId,
  onDoorbellRing: async () => {
    // Öffnet die Haustür nur für Sessions, die aktuell wirklich darauf warten
    // (d.h. der Gast hat sich zuvor per PIN legitimiert). Klingelt jemand ohne
    // gültige Session (z.B. Postbote), passiert nichts.
    const waiting = sessionsAwaitingBell();
    for (const session of waiting) {
      updateSession(session.token, { step: 'opening' });
      try {
        await ha.unlockRingIntercom(config.ringIntercomEntityId, config.ringIntercomService);
        updateSession(session.token, { step: 'street_door_open' });
        console.log(`[app] Haustür geöffnet für Session ${session.token.slice(0, 8)}...`);
      } catch (err) {
        console.error('[app] Haustür konnte nicht geöffnet werden:', err.message);
        updateSession(session.token, {
          step: 'await_bell',
          error: 'Haustür konnte nicht geöffnet werden. Bitte erneut klingeln oder Gastgeber kontaktieren.',
        });
      }
    }
  },
});
ha.connect();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
}

app.post('/api/verify-pin', (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN erforderlich.' });
  }

  const guest = findValidGuest(pin.trim());
  if (!guest) {
    recordAttempt(ip);
    return res.status(401).json({ error: 'PIN ungültig oder aktuell nicht gültig.' });
  }

  resetAttempts(ip);
  const token = createSession(guest);
  res.json({ token, guestLabel: guest.label || 'Gast' });
});

app.get('/api/session', (req, res) => {
  const token = req.query.token;
  const session = getSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.' });
  }
  res.json({ step: session.step, guestLabel: session.guestLabel, error: session.error || null });
});

app.post('/api/open-apartment-door', async (req, res) => {
  const { token } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res.status(404).json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.' });
  }
  if (session.step !== 'street_door_open' && session.step !== 'done') {
    return res.status(403).json({ error: 'Die Haustür wurde noch nicht geöffnet.' });
  }

  try {
    await ha.unlockNuki(config.nukiEntityId, config.nukiService);
    updateSession(token, { step: 'done' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[app] Wohnungstür konnte nicht geöffnet werden:', err.message);
    res.status(500).json({ error: 'Wohnungstür konnte nicht geöffnet werden. Bitte erneut versuchen.' });
  }
});

app.listen(config.port, () => {
  console.log(`[app] Server läuft auf Port ${config.port}`);
});
