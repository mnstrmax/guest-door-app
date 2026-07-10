#!/usr/bin/env node
// Kleines CLI-Tool, um einen neuen Gast (PIN + Gültigkeitszeitraum) zu guests.json hinzuzufügen.
// Aufruf: npm run add-guest

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GUESTS_FILE = path.join(__dirname, '..', 'guests.json');

function loadGuests() {
  try {
    return JSON.parse(fs.readFileSync(GUESTS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveGuests(guests) {
  fs.writeFileSync(GUESTS_FILE, JSON.stringify(guests, null, 2) + '\n');
}

if (fs.existsSync('/data/options.json')) {
  console.log(
    'Läuft als Home Assistant Add-on: Gäste werden über den Tab "Konfiguration" des Add-ons\n' +
      'gepflegt (Feld "guests"), nicht über dieses Skript. Danach das Add-on neu starten.'
  );
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

(async () => {
  const label = await ask('Name/Label des Gasts (z.B. "Familie Müller"): ');
  const pin = await ask('PIN (z.B. 4-6 Ziffern): ');
  const checkIn = await ask('Check-in (YYYY-MM-DD oder YYYY-MM-DDTHH:mm): ');
  const checkOut = await ask('Check-out (YYYY-MM-DD oder YYYY-MM-DDTHH:mm): ');
  rl.close();

  if (!pin) {
    console.error('Abgebrochen: PIN darf nicht leer sein.');
    process.exit(1);
  }

  const guests = loadGuests();
  guests.push({ label: label || 'Gast', pin, checkIn, checkOut });
  saveGuests(guests);
  console.log(`\nGast "${label}" mit PIN ${pin} hinzugefügt (gültig ${checkIn} bis ${checkOut}).`);
  console.log('guests.json wird bei jeder PIN-Eingabe neu eingelesen - kein Neustart nötig.');
})();
