const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const HAClient = require('./haClient');
const { findValidGuest, loadGuests, addGuest, updateGuest, deleteGuest } = require('./guests');
const { createSession, getSession, updateSession, sessionsAwaitingBell } = require('./sessions');
const { isRateLimited, recordAttempt, resetAttempts } = require('./rateLimiter');

console.log(`[app] Starte im Modus: ${config.mode}`);
console.log(`[app] imagesDir = ${config.imagesDir} (existiert: ${fs.existsSync(config.imagesDir)})`);
if (fs.existsSync(config.imagesDir)) {
  console.log(`[app] Inhalt: ${fs.readdirSync(config.imagesDir).join(', ') || '(leer)'}`);
}

const app = express();
app.use(express.json());
// no-cache statt Standard-Heuristik: Browser fragt bei jedem Laden per ETag beim
// Server nach, statt eine ggf. veraltete Kopie von index.html/app.js/i18n.js aus dem
// eigenen Cache zu verwenden (wichtig, damit Updates sofort ankommen, z.B. nach
// Sprach-Feature). Kostet praktisch nichts, da bei unveränderten Dateien nur ein
// schneller 304-Response zurückkommt.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);

// Bilder (Wohnungstür/Zimmer) liegen bewusst NICHT im Git-Repo, sondern nur lokal
// (Add-on: /config/guest-door-app-images, Standalone: images/-Ordner, per .gitignore
// ausgeschlossen). Fehlt eine Datei, liefert die Route 404 - das Frontend blendet das
// Bild dann einfach aus. Die tatsächliche Dateiendung ist egal (.jpg/.jpeg/.png) -
// es zählt nur der Name vor dem Punkt (z.B. "door"), damit z.B. iPhone-Fotos mit
// .jpeg-Endung nicht extra umbenannt werden müssen.
app.get('/images/:file', (req, res) => {
  const match = /^([a-zA-Z0-9_-]+)\.(jpg|jpeg|png)$/i.exec(req.params.file);
  if (!match) {
    return res.status(400).end();
  }
  const base = match[1];
  const candidate = ['jpg', 'jpeg', 'png']
    .map((ext) => path.join(config.imagesDir, `${base}.${ext}`))
    .find((p) => fs.existsSync(p));
  if (!candidate) {
    return res.status(404).end();
  }
  res.sendFile(candidate);
});

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
        await ha.notify(
          config.notifyService,
          `${session.guestName} hat geklingelt - Haustür wurde geöffnet.`,
          'Guest Door App'
        );
      } catch (err) {
        console.error('[app] Haustür konnte nicht geöffnet werden:', err.message);
        updateSession(session.token, {
          step: 'await_bell',
          error: 'Haustür konnte nicht geöffnet werden. Bitte erneut klingeln oder Gastgeber kontaktieren.',
          errorCode: 'street_door_failed',
        });
        await ha.notify(
          config.notifyService,
          `Haustür für ${session.guestName} konnte NICHT geöffnet werden!`,
          'Guest Door App ⚠️'
        );
      }
    }
    // Neu berechnen statt fest "off" setzen: bei Fehlschlag bleibt die Session weiterhin
    // "await_bell" (Gast klingelt evtl. erneut), der Helfer soll dann "on" bleiben.
    syncAppActiveHelper();
  },
});
ha.connect();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
}

// Hält den optionalen input_boolean-Helfer (falls konfiguriert) synchron zum tatsächlichen
// Zustand: "on", solange mindestens eine Session auf ein Klingeln wartet, sonst "off". Wird
// nach jeder relevanten Änderung UND regelmäßig als Sicherheitsnetz aufgerufen, damit der
// Helfer nicht dauerhaft "on" hängen bleibt, falls ein Gast nie klingelt und die Session nach
// 2 Stunden still verfällt (ohne eigenes Cleanup-Ereignis).
function syncAppActiveHelper() {
  if (!config.appActiveEntityId) return;
  const active = sessionsAwaitingBell().length > 0;
  ha.setInputBoolean(config.appActiveEntityId, active);
}
setInterval(syncAppActiveHelper, 60 * 1000);

app.post('/api/verify-pin', async (req, res) => {
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'rate_limited' });
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN erforderlich.', code: 'pin_required' });
  }

  const guest = findValidGuest(pin.trim());
  if (!guest) {
    recordAttempt(ip);
    return res.status(401).json({ error: 'PIN ungültig oder aktuell nicht gültig.', code: 'invalid_pin' });
  }

  resetAttempts(ip);
  const token = createSession(guest);
  syncAppActiveHelper();
  res.json({
    token,
    guestName: guest.name || 'Gast',
    // Diese Texte kommen nur aus der Add-on-/​.env-Konfiguration, nie aus dem Quellcode -
    // erst nach erfolgreicher PIN-Prüfung ausgeliefert.
    bellLabel: config.bellLabel,
    apartmentLocation: config.apartmentLocation,
    roomLocation: config.roomLocation,
  });

  await ha.notify(config.notifyService, `${guest.name || 'Ein Gast'} hat sich mit der PIN angemeldet.`, 'Guest Door App');
});

app.get('/api/session', (req, res) => {
  const token = req.query.token;
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  res.json({
    step: session.step,
    guestName: session.guestName,
    error: session.error || null,
    errorCode: session.errorCode || null,
  });
});

app.post('/api/open-apartment-door', async (req, res) => {
  const { token } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  if (session.step !== 'street_door_open' && session.step !== 'done') {
    return res.status(403).json({ error: 'Die Haustür wurde noch nicht geöffnet.', code: 'door_not_open' });
  }

  try {
    await ha.unlockNuki(config.nukiEntityId, config.nukiService);
    updateSession(token, { step: 'done' });
    res.json({ ok: true });

    await ha.notify(config.notifyService, `${session.guestName} ist in der Wohnung.`, 'Guest Door App');

    // Best-effort: Lichter einschalten. Schlägt das fehl, bleibt die Tür trotzdem offen -
    // daher kein Fehler an den Gast, nur ins Log.
    const lightEntities = [config.hallwayLightEntityId, config.guestroomLightEntityId].filter(Boolean);
    if (lightEntities.length > 0) {
      try {
        await ha.turnOnLights(lightEntities);
      } catch (err) {
        console.error('[app] Licht konnte nicht eingeschaltet werden:', err.message);
      }
    }
  } catch (err) {
    console.error('[app] Wohnungstür konnte nicht geöffnet werden:', err.message);
    res
      .status(500)
      .json({ error: 'Wohnungstür konnte nicht geöffnet werden. Bitte erneut versuchen.', code: 'apartment_door_failed' });
    await ha.notify(
      config.notifyService,
      `Wohnungstür für ${session.guestName} konnte NICHT geöffnet werden!`,
      'Guest Door App ⚠️'
    );
  }
});

// --- Admin-Bereich: Gäste-Verwaltung mit Datum/Zeit-Picker (nicht über HA-Add-on-Optionen
// möglich, daher eine eigene, passwortgeschützte Seite). ---

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const sepIdx = decoded.indexOf(':');
    const password = sepIdx >= 0 ? decoded.slice(sepIdx + 1) : decoded;
    if (password === config.adminPassword) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Guest Door App Admin"');
  return res.status(401).send('Authentifizierung erforderlich.');
}

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

app.get('/api/admin/guests', requireAdmin, (req, res) => {
  res.json(loadGuests());
});

app.post('/api/admin/guests', requireAdmin, (req, res) => {
  const { name, pin, checkIn, checkOut } = req.body || {};
  if (!name || !pin || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'name, pin, checkIn und checkOut sind erforderlich.' });
  }
  res.status(201).json(addGuest({ name, pin, checkIn, checkOut }));
});

app.put('/api/admin/guests/:id', requireAdmin, (req, res) => {
  const { name, pin, checkIn, checkOut } = req.body || {};
  if (!name || !pin || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'name, pin, checkIn und checkOut sind erforderlich.' });
  }
  const guest = updateGuest(req.params.id, { name, pin, checkIn, checkOut });
  if (!guest) return res.status(404).json({ error: 'Gast nicht gefunden.' });
  res.json(guest);
});

app.delete('/api/admin/guests/:id', requireAdmin, (req, res) => {
  const ok = deleteGuest(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Gast nicht gefunden.' });
  res.status(204).end();
});

app.listen(config.port, () => {
  console.log(`[app] Server läuft auf Port ${config.port}`);
});
