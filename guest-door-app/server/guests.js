const fs = require('fs');
const config = require('./config');

/**
 * Im Add-on-Modus kommt die Gästeliste direkt aus den Add-on-Optionen (Konfigurations-Tab
 * in Home Assistant), im Standalone-Modus aus guests.json (bei jedem Aufruf frisch gelesen,
 * damit z.B. das add-guest-Skript ohne Neustart wirkt).
 */
function loadGuests() {
  if (config.mode === 'addon') {
    return config.guests;
  }
  try {
    const raw = fs.readFileSync(config.guestsFile, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[guests] guests.json konnte nicht gelesen werden:', err.message);
    return [];
  }
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

module.exports = { loadGuests, findValidGuest };
