const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/**
 * Gäste liegen in einer JSON-Datei (addon: /data/guests.json, standalone: guests.json),
 * verwaltet über die /admin-Seite. Wird bei jedem Aufruf frisch von der Platte gelesen,
 * damit Änderungen sofort wirken - kein Neustart nötig.
 * Jeder Gast: { id, name, pin, checkIn, checkOut }
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
  const guest = { id: crypto.randomUUID(), name, pin, checkIn, checkOut };
  guests.push(guest);
  saveGuests(guests);
  return guest;
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

module.exports = { loadGuests, saveGuests, addGuest, updateGuest, deleteGuest, findValidGuest };
