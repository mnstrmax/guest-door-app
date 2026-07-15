const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const HAClient = require('./haClient');
const { findValidGuest, loadGuests, addGuest, updateGuest, deleteGuest, markCheckedIn } = require('./guests');
const { createSession, getSession, updateSession, sessionsAwaitingBell } = require('./sessions');
const {
  isRateLimited,
  recordAttempt,
  resetAttempts,
  isGloballyRateLimited,
  recordGlobalAttempt,
  resetGlobalAttempts,
  isAdminLoginRateLimited,
  recordAdminLoginAttempt,
  resetAdminLoginAttempts,
} = require('./rateLimiter');
const { createAdminSession, isValidAdminSession, destroyAdminSession } = require('./adminSessions');
const { verifyTotp, generateBase32Secret, buildOtpauthUri } = require('./totp');
const airbnbSync = require('./airbnbSync');

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
airbnbSync.start();

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
  // Zwei Limits: pro IP (bremst einzelne Absender) UND global über alle IPs hinweg
  // (verhindert, dass jemand das IP-Limit einfach durch viele verschiedene Absender-IPs
  // umgeht - bei nur 4-stelligen PINs die eigentlich wirksame Bremse gegen verteiltes
  // Brute-Forcing).
  if (isRateLimited(ip) || isGloballyRateLimited()) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.', code: 'rate_limited' });
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN erforderlich.', code: 'pin_required' });
  }

  const guest = findValidGuest(pin.trim());
  if (!guest) {
    recordAttempt(ip);
    const justLocked = recordGlobalAttempt();
    if (justLocked) {
      await ha.notify(
        config.notifyService,
        'Zu viele falsche PIN-Versuche insgesamt (verschiedene Absender möglich) - Anmeldung für 15 Minuten gesperrt.',
        'Guest Door App ⚠️'
      );
    }
    return res.status(401).json({ error: 'PIN ungültig oder aktuell nicht gültig.', code: 'invalid_pin' });
  }

  resetAttempts(ip);
  resetGlobalAttempts();
  // Rückkehrgast (hat den Tür-Ablauf schon einmal komplett durchlaufen und bestätigt):
  // statt wieder des Klingel-Ablaufs ein Menü zeigen - aber nur, wenn überhaupt eine
  // Zimmersteuerung konfiguriert ist. Sonst bringt ein Menü mit nur einer Option nichts,
  // dann läuft es wie bisher direkt in den Klingel-Ablauf.
  const returning = !!guest.checkedInAt && config.hasRoomControls;
  const initialStep = returning ? 'menu' : 'await_bell';
  const token = createSession(guest, initialStep);
  syncAppActiveHelper();
  res.json({
    token,
    guestName: guest.name || 'Gast',
    step: initialStep,
    // Diese Werte kommen nur aus der Add-on-/​.env-Konfiguration, nie aus dem Quellcode -
    // erst nach erfolgreicher PIN-Prüfung ausgeliefert. bellLabel ist ein Eigenname und
    // bleibt unübersetzt; apartmentFloor/apartmentSide/roomNumber/roomSide sind strukturiert,
    // damit das Frontend sie in jeder Sprache korrekt übersetzt einbauen kann.
    bellLabel: config.bellLabel,
    apartmentFloor: config.apartmentFloor,
    apartmentSide: config.apartmentSide,
    roomNumber: config.roomNumber,
    roomSide: config.roomSide,
  });

  await ha.notify(
    config.notifyService,
    returning
      ? `${guest.name || 'Ein Gast'} hat sich erneut angemeldet.`
      : `${guest.name || 'Ein Gast'} hat sich mit der PIN angemeldet.`,
    'Guest Door App'
  );
});

app.post('/api/menu/reopen-doors', (req, res) => {
  const { token } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  if (session.step !== 'menu') {
    return res.status(403).json({ error: 'Dieser Schritt ist nicht (mehr) verfügbar.', code: 'not_ready' });
  }
  updateSession(token, { step: 'await_bell' });
  syncAppActiveHelper();
  res.json({ ok: true });
});

app.post('/api/confirm-ok', async (req, res) => {
  const { token } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  if (session.step !== 'done') {
    return res.status(403).json({ error: 'Dieser Schritt ist noch nicht abgeschlossen.', code: 'not_ready' });
  }
  if (session.guestId) markCheckedIn(session.guestId);
  res.json({ ok: true });
  await ha.notify(config.notifyService, `${session.guestName} hat bestätigt: alles in Ordnung.`, 'Guest Door App');
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

// --- Zimmersteuerung für Rückkehrgäste (Heizung + 2 Lichter). Nur verfügbar, wenn
// mindestens eine der drei Entities konfiguriert ist (config.hasRoomControls). Zugriff
// erfordert nur eine gültige Session (beliebiger Schritt) - Gäste sollen z.B. auch
// während sie noch auf das Klingeln warten oder danach jederzeit ans Licht kommen. ---

app.get('/api/room-controls', async (req, res) => {
  const token = req.query.token;
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  if (!config.hasRoomControls) {
    return res.status(404).json({ error: 'Zimmersteuerung ist nicht konfiguriert.', code: 'controls_disabled' });
  }

  const [climate, ceiling, floor] = await Promise.all([
    ha.getState(config.guestroomClimateEntityId),
    ha.getState(config.guestroomCeilingLightEntityId),
    ha.getState(config.guestroomFloorLightEntityId),
  ]);

  res.json({
    climate:
      config.guestroomClimateEntityId && climate
        ? {
            currentTemperature: climate.attributes?.current_temperature ?? null,
            targetTemperature: climate.attributes?.temperature ?? null,
            minTemp: climate.attributes?.min_temp ?? 10,
            maxTemp: climate.attributes?.max_temp ?? 28,
          }
        : null,
    ceilingLight: config.guestroomCeilingLightEntityId && ceiling ? { on: ceiling.state === 'on' } : null,
    floorLight: config.guestroomFloorLightEntityId && floor ? { on: floor.state === 'on' } : null,
  });
});

app.post('/api/room-controls/light', async (req, res) => {
  const { token, target, on } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  const entityId =
    target === 'ceiling'
      ? config.guestroomCeilingLightEntityId
      : target === 'floor'
        ? config.guestroomFloorLightEntityId
        : null;
  if (!entityId) {
    return res.status(400).json({ error: 'Unbekannte Lampe.', code: 'invalid_target' });
  }
  try {
    await ha.setLight(entityId, !!on);
    res.json({ ok: true });
  } catch (err) {
    console.error('[app] Licht konnte nicht geschaltet werden:', err.message);
    res.status(500).json({ error: 'Licht konnte nicht geschaltet werden.', code: 'light_failed' });
  }
});

app.post('/api/room-controls/climate', async (req, res) => {
  const { token, temperature } = req.body || {};
  const session = getSession(token);
  if (!session) {
    return res
      .status(404)
      .json({ error: 'Session abgelaufen oder ungültig. Bitte PIN erneut eingeben.', code: 'session_invalid' });
  }
  if (!config.guestroomClimateEntityId) {
    return res.status(400).json({ error: 'Heizung ist nicht konfiguriert.', code: 'invalid_target' });
  }
  const temp = Number(temperature);
  if (!Number.isFinite(temp)) {
    return res.status(400).json({ error: 'Ungültige Temperatur.', code: 'invalid_temperature' });
  }
  try {
    await ha.setClimateTemperature(config.guestroomClimateEntityId, temp);
    res.json({ ok: true });
  } catch (err) {
    console.error('[app] Temperatur konnte nicht gesetzt werden:', err.message);
    res.status(500).json({ error: 'Temperatur konnte nicht gesetzt werden.', code: 'climate_failed' });
  }
});

// --- Admin-Bereich: Gäste-Verwaltung mit Datum/Zeit-Picker (nicht über HA-Add-on-Optionen
// möglich, daher eine eigene, session-geschützte Seite mit Login + optionaler 2FA). ---

// Kleine Cookie-Helfer ohne zusätzliche Dependency (cookie-parser o.ä.) - das Format ist
// simpel genug ("key=value; key2=value2"), ein eigener Parser hält das Projekt weiterhin
// dependency-arm.
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_MAX_AGE_S = 12 * 60 * 60; // muss zu SESSION_TTL_MS in adminSessions.js passen

function setAdminSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${ADMIN_SESSION_MAX_AGE_S}; SameSite=Lax`
  );
}

function clearAdminSessionCookie(res) {
  res.setHeader('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Zeitkonstanter String-Vergleich (über Hashes, damit unterschiedlich lange Eingaben
// nicht schon an der Länge scheitern - crypto.timingSafeEqual verlangt gleich lange
// Buffer). Verhindert Timing-Seitenkanäle beim Passwortvergleich.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdminSession(req, res, next) {
  const cookies = parseCookies(req);
  if (isValidAdminSession(cookies[ADMIN_SESSION_COOKIE])) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Anmeldung erforderlich.', code: 'admin_auth_required' });
  }
  return res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'login.html'));
});

app.post('/admin/login', async (req, res) => {
  const ip = getClientIp(req);
  if (isAdminLoginRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
  }

  const { username, password, totp } = req.body || {};
  const usernameOk = timingSafeEqualStr(username, config.adminUsername);
  const passwordOk = typeof password === 'string' && timingSafeEqualStr(password, config.adminPassword);
  const totpOk = config.adminTotpSecret ? verifyTotp(config.adminTotpSecret, totp) : true;

  if (!usernameOk || !passwordOk || !totpOk) {
    recordAdminLoginAttempt(ip);
    await ha.notify(
      config.notifyService,
      'Fehlgeschlagener Login-Versuch im Admin-Bereich der Guest Door App.',
      'Guest Door App ⚠️'
    );
    return res.status(401).json({ error: 'Benutzername, Passwort oder Code falsch.' });
  }

  resetAdminLoginAttempts(ip);
  const token = createAdminSession();
  setAdminSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  const cookies = parseCookies(req);
  destroyAdminSession(cookies[ADMIN_SESSION_COOKIE]);
  clearAdminSessionCookie(res);
  res.json({ ok: true });
});

app.get('/admin', requireAdminSession, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

app.get('/api/admin/guests', requireAdminSession, (req, res) => {
  res.json(loadGuests());
});

// Manueller Anstoß des Airbnb-Kalender-Syncs (normalerweise läuft er automatisch
// stündlich im Hintergrund) - praktisch, um nach einer frischen Buchung nicht bis zu
// einer Stunde warten zu müssen, bis der neue Gast in der Liste auftaucht.
app.post('/api/admin/sync-airbnb', requireAdminSession, async (req, res) => {
  if (!config.airbnbIcalUrl) {
    return res.status(400).json({ error: 'Kein Airbnb-Kalender-Link konfiguriert (airbnb_ical_url).' });
  }
  const result = await airbnbSync.runSync();
  if (result?.error) {
    return res.status(502).json({ error: result.error });
  }
  res.json(result);
});

// Generiert ein neues TOTP-Secret zum Einrichten der 2FA. Erfordert bereits eine gültige
// Admin-Session (Henne-Ei-Problem gelöst: die allererste Einrichtung passiert, solange
// admin_totp_secret noch leer ist und der Login daher nur Benutzername+Passwort verlangt).
// Schreibt NICHTS automatisch in die Add-on-Konfiguration - der Host trägt das Secret
// selbst in admin_totp_secret ein und startet das Add-on neu, genau wie bei allen anderen
// Konfigurationswerten dieser App.
app.post('/api/admin/generate-totp-secret', requireAdminSession, (req, res) => {
  const secret = generateBase32Secret();
  res.json({ secret, otpauthUri: buildOtpauthUri(secret, { label: `Guest Door App:${config.adminUsername}` }) });
});

app.post('/api/admin/guests', requireAdminSession, (req, res) => {
  const { name, pin, checkIn, checkOut } = req.body || {};
  if (!name || !pin || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'name, pin, checkIn und checkOut sind erforderlich.' });
  }
  res.status(201).json(addGuest({ name, pin, checkIn, checkOut }));
});

app.put('/api/admin/guests/:id', requireAdminSession, (req, res) => {
  const { name, pin, checkIn, checkOut } = req.body || {};
  if (!name || !pin || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'name, pin, checkIn und checkOut sind erforderlich.' });
  }
  const guest = updateGuest(req.params.id, { name, pin, checkIn, checkOut });
  if (!guest) return res.status(404).json({ error: 'Gast nicht gefunden.' });
  res.json(guest);
});

app.delete('/api/admin/guests/:id', requireAdminSession, (req, res) => {
  const ok = deleteGuest(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Gast nicht gefunden.' });
  res.status(204).end();
});

app.listen(config.port, () => {
  console.log(`[app] Server läuft auf Port ${config.port}`);
});
