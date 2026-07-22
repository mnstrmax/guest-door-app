const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/**
 * Gäste liegen in einer JSON-Datei (addon: /data/guests.json, standalone: guests.json),
 * verwaltet über die /admin-Seite. Wird bei jedem Aufruf frisch von der Platte gelesen,
 * damit Änderungen sofort wirken - kein Neustart nötig.
 * Jeder Gast: { id, name, pin, checkIn, checkOut, checkedInAt, icalUid, confirmationCode, confirmed }
 * checkedInAt: null, bis der Gast einmal den kompletten Tür-Ablauf durchlaufen und
 * "Alles in Ordnung" bestätigt hat - ab dann bekommt er bei erneuter PIN-Eingabe ein
 * Menü (Türen nochmal öffnen / Zimmer steuern) statt wieder des Klingel-Ablaufs.
 * icalUid: gesetzt, wenn der Gast automatisch aus dem Airbnb-Kalender importiert wurde
 * (siehe airbnbSync.js) - verknüpft den Eintrag mit der Reservierungs-ID aus dem
 * iCal-Feed, damit spätere Syncs denselben Gast aktualisieren statt zu duplizieren, und
 * damit der Sync manuell (ohne icalUid) angelegte Gäste niemals anfasst. null bei
 * manuell über /admin angelegten Gästen.
 * confirmationCode: optional, Airbnbs Buchungscode (z.B. "HM4QZY53HT") aus der
 * Buchungsbestätigungsmail (siehe emailSync.js/emailParse.js). Null, bis ein E-Mail-Sync
 * ihn gefunden hat.
 * confirmed: Airbnbs Kalender-Feed enthält auch noch unbestätigte Buchungsanfragen (nicht
 * nur endgültig angenommene Reservierungen) - ohne dieses Feld würde ein Gast schon PIN-
 * Zugriff bekommen, bevor der Gastgeber die Anfrage überhaupt angenommen hat. Manuell über
 * /admin angelegte Gäste sind immer confirmed:true (der Gastgeber legt sie ja selbst an).
 * Per iCal importierte Gäste starten mit confirmed:false, SOBALD ein E-Mail-Postfach für
 * den Buchungsmail-Sync konfiguriert ist (config.hasEmailSync) - erst die zugehörige
 * "Buchung bestätigt"-Mail (siehe applyEmailEnrichment) oder ein manueller Klick auf
 * "Buchung bestätigen" in /admin (siehe confirmGuest) schaltet die PIN scharf. Ist kein
 * E-Mail-Postfach konfiguriert, gibt es keine andere Quelle für eine Bestätigung - dann
 * bleibt es beim bisherigen Verhalten (confirmed:true sofort bei Import).
 */
function loadGuests() {
  try {
    const raw = fs.readFileSync(config.guestsFile, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('[guests] Gästedatei konnte nicht gelesen werden:', err.message);
    return [];
  }
}

function saveGuests(guests) {
  const dir = path.dirname(config.guestsFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.guestsFile, JSON.stringify(guests, null, 2) + '\n');
}

function addGuest({ name, pin, checkIn, checkOut }) {
  const guests = loadGuests();
  const guest = {
    id: crypto.randomUUID(),
    name,
    pin,
    checkIn,
    checkOut,
    checkedInAt: null,
    icalUid: null,
    confirmationCode: null,
    // Manuell angelegte Gäste sind immer sofort bestätigt - der Gastgeber legt sie selbst
    // an, es gibt hier keine "Anfrage vs. bestätigt"-Unterscheidung wie beim Kalender-Sync.
    confirmed: true,
  };
  guests.push(guest);
  saveGuests(guests);
  return guest;
}

/**
 * Legt einen Gast aus dem Airbnb-Kalender-Sync an oder aktualisiert ihn (verknüpft über
 * icalUid). Der Name wird bei einem Update bewusst NICHT überschrieben - Airbnbs iCal-Feed
 * liefert ohnehin keinen Namen (nur "Reserved"), d.h. beim ersten Sync landet ein
 * Platzhalter im Namensfeld, den der Gastgeber in /admin durch den echten Namen ersetzen
 * kann. Spätere Syncs (z.B. weil sich Check-in/Check-out geändert hat) dürfen diese
 * manuelle Korrektur nicht wieder überschreiben.
 */
function upsertSyncedGuest({ icalUid, name, pin, checkIn, checkOut }) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.icalUid === icalUid);
  if (idx === -1) {
    const guest = {
      id: crypto.randomUUID(),
      name,
      pin,
      checkIn,
      checkOut,
      checkedInAt: null,
      icalUid,
      confirmationCode: null,
      // Airbnbs Kalender-Feed enthält auch unbestätigte Anfragen (siehe Kommentar oben an
      // der Datei) - ohne konfigurierten E-Mail-Sync gibt es aber keine andere Quelle für
      // eine Bestätigung, dann bleibt es beim bisherigen Sofort-gültig-Verhalten.
      confirmed: !config.hasEmailSync,
    };
    guests.push(guest);
    saveGuests(guests);
    return { guest, created: true };
  }
  // confirmed bewusst NICHT zurücksetzen - ein bereits bestätigter Gast darf das nicht
  // durch einen späteren Kalender-Sync (z.B. weil sich nur die Uhrzeit geändert hat)
  // wieder verlieren.
  guests[idx] = { ...guests[idx], pin, checkIn, checkOut };
  saveGuests(guests);
  return { guest: guests[idx], created: false };
}

/**
 * Setzt checkOut auf einen Zeitpunkt in der Vergangenheit für alle synchronisierten Gäste
 * (icalUid gesetzt), deren UID nicht mehr im aktuellen iCal-Feed vorkommt - typischerweise,
 * weil die Reservierung auf Airbnb storniert wurde. Der PIN wird dadurch sofort ungültig
 * (findValidGuest prüft checkIn <= jetzt <= checkOut), ohne den Eintrag zu löschen, damit
 * die Historie sichtbar bleibt. Rührt manuell angelegte Gäste (icalUid: null) nicht an.
 */
function invalidateMissingSyncedGuests(currentUids) {
  const guests = loadGuests();
  const currentSet = new Set(currentUids);
  let changed = false;
  const past = new Date(0).toISOString();
  for (const g of guests) {
    if (g.icalUid && !currentSet.has(g.icalUid) && g.checkOut !== past) {
      g.checkOut = past;
      changed = true;
    }
  }
  if (changed) saveGuests(guests);
  return changed;
}

/**
 * Sucht unter den per iCal-Sync importierten, noch NICHT bestätigten Gästen (icalUid
 * gesetzt, confirmed:false) genau einen mit demselben Check-in-Kalendertag und markiert
 * ihn als bestätigt - das schaltet seine PIN scharf (siehe findValidGuest). Trägt dabei
 * auch gleich den echten Namen (nur falls noch der Platzhalter "Airbnb-Gast" gesetzt ist -
 * eine schon manuell erfolgte Korrektur wird nie überschrieben) sowie den Bestätigungscode
 * aus der Buchungsbestätigungsmail ein (siehe emailSync.js). Bewusst NICHT mehr am
 * Namens-Platzhalter als alleinigem Kriterium festgemacht (früher: g.name !==
 * 'Airbnb-Gast') - sonst würde ein schon manuell umbenannter, aber noch unbestätigter
 * Gast nie mehr bestätigt werden, obwohl genau das der Zweck dieser Mail ist. Gibt bei
 * Erfolg den aktualisierten Gast zurück, sonst null - sowohl wenn gar kein Kandidat
 * gefunden wurde (z.B. weil der Kalender-Sync noch nicht gelaufen ist - der nächste
 * Mail-Sync-Durchlauf versucht es dann erneut) als auch wenn mehrere Kandidaten am
 * selben Tag infrage kämen (dann lieber nichts anfassen, statt riskieren, den falschen
 * Gast zu bestätigen).
 */
function applyEmailEnrichment({ checkInDate, name, confirmationCode }) {
  const guests = loadGuests();
  const dayStart = new Date(checkInDate.getFullYear(), checkInDate.getMonth(), checkInDate.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const candidateIds = guests
    .filter((g) => {
      if (!g.icalUid || g.confirmed) return false;
      const ci = new Date(g.checkIn);
      return ci >= dayStart && ci < dayEnd;
    })
    .map((g) => g.id);

  if (candidateIds.length !== 1) return null;

  const idx = guests.findIndex((g) => g.id === candidateIds[0]);
  guests[idx] = {
    ...guests[idx],
    name: guests[idx].name === 'Airbnb-Gast' ? name || guests[idx].name : guests[idx].name,
    confirmationCode: confirmationCode || guests[idx].confirmationCode || null,
    confirmed: true,
  };
  saveGuests(guests);
  return guests[idx];
}

/**
 * Markiert einen Gast als "hat den Tür-Ablauf schon einmal komplett durchlaufen".
 * Wird beim Klick auf "Alles in Ordnung" aufgerufen (auch bei erneutem Öffnen der
 * Türen über das Rückkehrgast-Menü - schadet nicht, aktualisiert nur den Zeitstempel).
 */
function markCheckedIn(id) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  guests[idx] = { ...guests[idx], checkedInAt: Date.now() };
  saveGuests(guests);
  return guests[idx];
}

/**
 * Setzt checkOut eines aktuell aktiven Gasts (PIN gerade gültig) auf den aktuellen
 * Zeitpunkt - für Gäste, die schon vor dem eigentlich hinterlegten Check-out abgereist
 * sind. Macht die PIN sofort ungültig (findValidGuest prüft checkIn <= jetzt <= checkOut),
 * ohne den Eintrag zu löschen, damit die Historie sichtbar bleibt. Aufgerufen über den
 * Button "Bereits ausgecheckt" in /admin.
 */
function markCheckedOut(id) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  guests[idx] = { ...guests[idx], checkOut: new Date().toISOString() };
  saveGuests(guests);
  return guests[idx];
}

/**
 * Manuelles Bestätigen einer Kalender-Buchung (siehe confirmed-Feld oben) - falls die
 * Buchungsmail nie ankommt (z.B. vergessen weiterzuleiten, IMAP kurzzeitig down) oder
 * gar kein E-Mail-Sync konfiguriert ist, würde die PIN sonst dauerhaft ungültig bleiben.
 * Button "Buchung bestätigen" in /admin, nur sichtbar bei noch unbestätigten Gästen.
 */
function confirmGuest(id) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  guests[idx] = { ...guests[idx], confirmed: true };
  saveGuests(guests);
  return guests[idx];
}

function updateGuest(id, { name, pin, checkIn, checkOut }) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.id === id);
  if (idx === -1) return null;
  // confirmationCode bleibt beim manuellen Bearbeiten unangetastet (kommt nur aus dem
  // E-Mail-Sync, kein Formularfeld in /admin) - würde sonst durch das Editier-Formular
  // versehentlich auf undefined überschrieben.
  guests[idx] = { ...guests[idx], name, pin, checkIn, checkOut };
  saveGuests(guests);
  return guests[idx];
}

function deleteGuest(id) {
  const guests = loadGuests();
  const next = guests.filter((g) => g.id !== id);
  saveGuests(next);
  return next.length !== guests.length;
}

/**
 * Findet einen Gast, dessen PIN passt UND dessen Gültigkeitszeitraum
 * (checkIn <= jetzt <= checkOut) den aktuellen Zeitpunkt einschließt.
 * So laufen alte PINs automatisch ab, ohne dass die Gästeliste manuell bereinigt werden muss.
 * Zusätzlich: ein per Kalender importierter, aber noch nicht bestätigter Gast (confirmed:
 * false - siehe Kommentar oben an der Datei) ist nie gültig, SOFERN ein E-Mail-Sync
 * konfiguriert ist (config.hasEmailSync) - sonst könnte schon eine unbestätigte
 * Airbnb-Anfrage physischen Zugang gewähren, bevor der Gastgeber sie überhaupt
 * angenommen hat. Ohne konfigurierten E-Mail-Sync gibt es keine andere Bestätigungsquelle,
 * dann greift diese zusätzliche Prüfung nicht (confirmed ist dann ohnehin immer true, siehe
 * upsertSyncedGuest).
 */
function findValidGuest(pin) {
  const guests = loadGuests();
  const now = new Date();
  return (
    guests.find((g) => {
      if (g.pin !== pin) return false;
      if (g.icalUid && config.hasEmailSync && !g.confirmed) return false;
      const checkIn = new Date(g.checkIn);
      const checkOut = new Date(g.checkOut);
      return now >= checkIn && now <= checkOut;
    }) || null
  );
}

module.exports = {
  loadGuests,
  saveGuests,
  addGuest,
  updateGuest,
  deleteGuest,
  findValidGuest,
  markCheckedIn,
  markCheckedOut,
  confirmGuest,
  upsertSyncedGuest,
  invalidateMissingSyncedGuests,
  applyEmailEnrichment,
};
