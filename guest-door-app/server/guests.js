const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/**
 * Gäste liegen in einer JSON-Datei (addon: /data/guests.json, standalone: guests.json),
 * verwaltet über die /admin-Seite. Wird bei jedem Aufruf frisch von der Platte gelesen,
 * damit Änderungen sofort wirken - kein Neustart nötig.
 * Jeder Gast: { id, name, pin, checkIn, checkOut, checkedInAt, icalUid }
 * checkedInAt: null, bis der Gast einmal den kompletten Tür-Ablauf durchlaufen und
 * "Alles in Ordnung" bestätigt hat - ab dann bekommt er bei erneuter PIN-Eingabe ein
 * Menü (Türen nochmal öffnen / Zimmer steuern) statt wieder des Klingel-Ablaufs.
 * icalUid: gesetzt, wenn der Gast automatisch aus dem Airbnb-Kalender importiert wurde
 * (siehe airbnbSync.js) - verknüpft den Eintrag mit der Reservierungs-ID aus dem
 * iCal-Feed, damit spätere Syncs denselben Gast aktualisieren statt zu duplizieren, und
 * damit der Sync manuell (ohne icalUid) angelegte Gäste niemals anfasst. null bei
 * manuell über /admin angelegten Gästen.
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
  const guest = { id: crypto.randomUUID(), name, pin, checkIn, checkOut, checkedInAt: null, icalUid: null };
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
    const guest = { id: crypto.randomUUID(), name, pin, checkIn, checkOut, checkedInAt: null, icalUid };
    guests.push(guest);
    saveGuests(guests);
    return { guest, created: true };
  }
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

function updateGuest(id, { name, pin, checkIn, checkOut }) {
  const guests = loadGuests();
  const idx = guests.findIndex((g) => g.id === id);
  if (idx === -1) return null;
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
 */
function findValidGuest(pin) {
  const guests = loadGuests();
  const now = new Date();
  return (
    guests.find((g) => {
      if (g.pin !== pin) return false;
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
  upsertSyncedGuest,
  invalidateMissingSyncedGuests,
};
