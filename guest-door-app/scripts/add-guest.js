#!/usr/bin/env node
// Kleines CLI-Tool, um einen neuen Gast per Kommandozeile hinzuzufügen.
// Komfortabler geht's über die /admin-Seite (mit Datum/Zeit-Picker) - dieses Skript
// ist ein Fallback, z.B. für Automatisierung/Scripting.
// Aufruf: npm run add-guest

const readline = require('readline');
const { addGuest } = require('../server/guests');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  const name = await ask('Name des Gasts (z.B. "Familie Müller"): ');
  const pin = await ask('PIN (z.B. 4-6 Ziffern): ');
  const checkIn = await ask('Check-in (YYYY-MM-DDTHH:mm, z.B. 2026-07-10T15:00): ');
  const checkOut = await ask('Check-out (YYYY-MM-DDTHH:mm, z.B. 2026-07-14T11:00): ');
  rl.close();

  if (!pin) {
    console.error('Abgebrochen: PIN darf nicht leer sein.');
    process.exit(1);
  }

  const guest = addGuest({ name: name || 'Gast', pin, checkIn, checkOut });
  console.log(`\nGast "${guest.name}" mit PIN ${guest.pin} hinzugefügt (gültig ${checkIn} bis ${checkOut}).`);
  console.log('Wirkt sofort, kein Neustart nötig. Bearbeiten/Löschen geht bequemer über /admin.');
})();
