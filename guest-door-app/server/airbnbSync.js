const config = require('./config');
const { upsertSyncedGuest, invalidateMissingSyncedGuests } = require('./guests');

// Airbnbs eigener Kalender aktualisiert sich laut Airbnb-Doku alle 3 Stunden - stündlich
// prüfen reicht also mehr als aus und erzeugt keine unnötige Last.
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

/**
 * RFC5545 (iCalendar): eine Zeile, die mit genau einem Leerzeichen oder Tab beginnt, ist
 * die Fortsetzung der vorherigen Zeile ("Line Folding") und muss ohne das führende
 * Whitespace-Zeichen wieder angehängt werden.
 */
function unfoldLines(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

// RFC5545-Escaping in Textwerten (DESCRIPTION/SUMMARY) rückgängig machen.
function unescapeIcsText(value) {
  if (!value) return '';
  return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Zerlegt eine einzelne (bereits entfaltete) Property-Zeile wie
// "DTSTART;VALUE=DATE:20260710" in { name: 'DTSTART', params: { VALUE: 'DATE' }, value: '20260710' }.
function parseLine(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const eqIdx = p.indexOf('=');
    if (eqIdx === -1) continue;
    params[p.slice(0, eqIdx).toUpperCase()] = p.slice(eqIdx + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/**
 * Wandelt einen DTSTART/DTEND-Wert in ein JS-Date um. Ganztägige Termine (VALUE=DATE bzw.
 * reines YYYYMMDD, so exportiert Airbnb Reservierungen) werden mit der konfigurierten
 * Check-in-/Check-out-Uhrzeit kombiniert - sonst wäre der PIN schon ab Mitternacht des
 * Anreisetags und noch bis Mitternacht des Abreisetags gültig, statt zur tatsächlichen
 * Uhrzeit. timeOfDay-Format: "HH:MM".
 */
function parseIcsDate(value, params, timeOfDay) {
  const dateOnlyMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnlyMatch && (params?.VALUE === 'DATE' || !value.includes('T'))) {
    const [, y, m, d] = dateOnlyMatch;
    const [hh, mm] = (timeOfDay || '00:00').split(':').map(Number);
    return new Date(Number(y), Number(m) - 1, Number(d), hh || 0, mm || 0, 0);
  }
  const dtMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (dtMatch) {
    const [, y, m, d, hh, mm, ss, z] = dtMatch;
    if (z) return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
    return new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  return null;
}

function parseIcs(text) {
  const lines = unfoldLines(text);
  const events = [];
  let current = null;
  for (const raw of lines) {
    if (raw === 'BEGIN:VEVENT') {
      current = {};
    } else if (raw === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
    } else if (current) {
      const parsed = parseLine(raw);
      if (!parsed) continue;
      if (parsed.name === 'UID') current.uid = parsed.value;
      else if (parsed.name === 'SUMMARY') current.summary = unescapeIcsText(parsed.value);
      else if (parsed.name === 'DESCRIPTION') current.description = unescapeIcsText(parsed.value);
      else if (parsed.name === 'DTSTART') current.dtstartRaw = parsed;
      else if (parsed.name === 'DTEND') current.dtendRaw = parsed;
    }
  }
  return events;
}

// Airbnb liefert seit Ende 2019 keinen Gastnamen mehr in der DESCRIPTION, nur noch die
// letzten 4 Ziffern der Telefonnummer, üblicherweise als "Phone Number (Last 4 Digits): 1234".
// [^:]{0,60} statt [^\d]{0,60} als Lücken-Klasse, weil "Last 4 Digits" selbst eine Ziffer
// enthält - würde sonst die eigene Bezeichnung blockieren.
const PHONE_SUFFIX_RE = /(?:phone(?:\s*number)?|last\s*4\s*digits?)[^:]{0,60}:\s*(\d{4})\b/i;

function extractPhoneLast4(description) {
  if (!description) return null;
  const match = PHONE_SUFFIX_RE.exec(description);
  return match ? match[1] : null;
}

// Für die Push-Benachrichtigung bei neu importierten Gästen: kurzes, gut lesbares
// deutsches Datum statt ISO-String.
function formatDateDe(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function fetchIcsText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iCal-Abruf fehlgeschlagen (${res.status})`);
  }
  return res.text();
}

/**
 * Holt den Airbnb-Kalender, erkennt Reservierungen (Termine mit erkennbarer
 * Telefonnummer in der Beschreibung - reine manuelle Blockierungen ohne Buchung haben
 * keine und werden übersprungen) und legt dafür Gäste an/aktualisiert sie. Reservierungen,
 * die aus dem Feed verschwunden sind (z.B. storniert), werden sofort invalidiert. Für neu
 * angelegte Gäste (Airbnb liefert keinen Namen, nur "Airbnb-Gast" als Platzhalter) geht
 * eine Push-Benachrichtigung raus, damit der Name zeitnah in /admin ergänzt wird.
 * Best-effort: Netzwerk-/Parse-Fehler landen nur im Log, blockieren nie den Rest der App.
 * @param {object} [ha] - HAClient-Instanz für Push-Benachrichtigungen (optional).
 */
async function runSync(ha) {
  if (!config.airbnbIcalUrl) return { skipped: true };

  let text;
  try {
    text = await fetchIcsText(config.airbnbIcalUrl);
  } catch (err) {
    console.error('[airbnb-sync] iCal konnte nicht abgerufen werden:', err.message);
    return { error: err.message };
  }

  let events;
  try {
    events = parseIcs(text);
  } catch (err) {
    console.error('[airbnb-sync] iCal konnte nicht geparst werden:', err.message);
    return { error: err.message };
  }

  let created = 0;
  let updated = 0;
  let skippedNoPhone = 0;
  const currentUids = [];
  const newGuests = []; // für die Push-Benachrichtigung am Ende: { checkIn, pin }

  for (const ev of events) {
    if (!ev.uid || !ev.dtstartRaw || !ev.dtendRaw) continue;

    const pin = extractPhoneLast4(ev.description);
    if (!pin) {
      skippedNoPhone += 1;
      continue;
    }

    const checkInDate = parseIcsDate(ev.dtstartRaw.value, ev.dtstartRaw.params, config.defaultCheckinTime);
    const checkOutDate = parseIcsDate(ev.dtendRaw.value, ev.dtendRaw.params, config.defaultCheckoutTime);
    if (!checkInDate || !checkOutDate) {
      console.warn(`[airbnb-sync] Datum von Termin ${ev.uid} konnte nicht gelesen werden, überspringe.`);
      continue;
    }

    currentUids.push(ev.uid);
    const { created: wasCreated } = upsertSyncedGuest({
      icalUid: ev.uid,
      name: 'Airbnb-Gast',
      pin,
      checkIn: checkInDate.toISOString(),
      checkOut: checkOutDate.toISOString(),
    });
    if (wasCreated) {
      created += 1;
      newGuests.push({ checkIn: checkInDate, pin });
    } else {
      updated += 1;
    }
  }

  const invalidated = invalidateMissingSyncedGuests(currentUids);

  const summary = { total: events.length, created, updated, skippedNoPhone, invalidated };
  console.log(
    `[airbnb-sync] ${events.length} Termine im Feed, ${created} neu, ${updated} aktualisiert, ` +
      `${skippedNoPhone} ohne Telefonnummer übersprungen${invalidated ? ', fehlende Reservierungen invalidiert' : ''}.`
  );

  // Airbnb liefert keinen Gastnamen mit (siehe extractPhoneLast4) - neu angelegte Gäste
  // tragen bis zur manuellen Korrektur nur den Platzhalter "Airbnb-Gast". Push-Hinweis,
  // damit der Name zeitnah in /admin ergänzt wird (u.a. für die persönliche Begrüßung).
  if (ha && newGuests.length > 0) {
    const lines = newGuests.map((g) => `- Check-in ${formatDateDe(g.checkIn)}, PIN ${g.pin}`);
    const title =
      newGuests.length === 1
        ? 'Neuer Gast aus Airbnb-Kalender importiert'
        : `${newGuests.length} neue Gäste aus Airbnb-Kalender importiert`;
    const message = `Bitte Name(n) in /admin ergänzen:\n${lines.join('\n')}`;
    try {
      await ha.notify(config.notifyService, message, title);
    } catch (err) {
      console.error('[airbnb-sync] Benachrichtigung über neue Gäste fehlgeschlagen:', err.message);
    }
  }

  return summary;
}

function start(ha) {
  if (!config.airbnbIcalUrl) return;
  console.log('[airbnb-sync] Airbnb-Kalender-Sync aktiviert (stündlich, plus einmal jetzt beim Start).');
  runSync(ha);
  setInterval(() => runSync(ha), SYNC_INTERVAL_MS);
}

module.exports = {
  start,
  runSync,
  parseIcs,
  parseIcsDate,
  unfoldLines,
  extractPhoneLast4,
};
