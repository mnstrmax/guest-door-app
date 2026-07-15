// Reine Text-Extraktion aus einer Airbnb-Buchungsbestätigungsmail. Bekommt bereits als
// Klartext vorliegenden Mailinhalt (z.B. von mailparser aus der Roh-Mail extrahiert) und
// zieht daraus Gastname, Bestätigungscode, Check-in-Datum und eine eventuelle
// Freitextnachricht des Gasts. Komplett unabhängig von IMAP/MIME-Verarbeitung (siehe
// emailSync.js), damit sich diese eigentliche Business-Logik ohne echten Mail-Server
// testen lässt - genau die Art von Logik, die wir im Rest der App bewusst selbst bauen,
// statt sie einer Bibliothek zu überlassen.
//
// Airbnbs Mail-Layout ändert sich gelegentlich und die genaue Zeilenumbruch-Struktur nach
// HTML->Text-Konvertierung ist nicht exakt vorhersagbar - alle Muster arbeiten deshalb mit
// toleranten "irgendwas dazwischen"-Fenstern ([\s\S]{0,N}?) statt starrer \n-Erwartungen.

// Erkennt Buchungsbestätigungs-Mails ausschließlich am Betreff ("Buchung bestätigt ...").
// Bewusst KEIN Absender-Check: Landet die Mail per manueller Weiterleitung im dedizierten
// Postfach (siehe README, Abschnitt "E-Mail-Sync"), bist du selbst der Absender, nicht
// mehr automated@airbnb.com - der Betreff bleibt dabei aber unverändert (nur mit
// "Fwd:"-Präfix, das das Muster nicht stört, da es nicht am Zeilenanfang verankert ist).
// Dass ein reiner Betreffs-Treffer genügt, ist hier unbedenklich, weil dieses Postfach
// laut Empfehlung ohnehin ausschließlich für genau diesen Zweck angelegt wird.
function isBookingConfirmationEmail({ subject }) {
  return /buchung best[aä]tigt/i.test(subject || '');
}

// "Bestätigungs-Code\nHM4QZY53HT" (oder mit anderem Whitespace dazwischen) -> "HM4QZY53HT"
function extractConfirmationCode(text) {
  const m = /Best[aä]tigungs-Code[\s\S]{0,10}?\b([A-Z0-9]{6,12})\b/.exec(text || '');
  return m ? m[1] : null;
}

// Der volle Gastname steht im Mailtext als eigene Zeile direkt vor "Identität verifiziert".
// Fallback: aus dem Betreff ("Buchung bestätigt – NAME kommt am ...") oder der Überschrift
// ("Neue Buchung bestätigt: NAME kommt am ...").
function extractGuestName(text, subject) {
  const bodyMatch = /\n([A-ZÄÖÜ][^\n]{1,60}?)\n[\s\S]{0,20}?Identit[aä]t verifiziert/.exec(text || '');
  if (bodyMatch) return bodyMatch[1].trim();

  const subjMatch = /Buchung best[aä]tigt[\s\S]{0,5}?[:–-][\s\S]{0,3}?([A-ZÄÖÜ][^\n]{1,60}?)\s+kommt am/i.exec(
    subject || ''
  );
  if (subjMatch) return subjMatch[1].trim();

  return null;
}

const DE_MONTHS = {
  januar: 0,
  februar: 1,
  märz: 2,
  maerz: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  dezember: 11,
};

/**
 * "Check-in\nFr., 17. Juli\n15:00" -> Date. Das Jahr steht nirgends in der Mail, deshalb
 * wird das nächste Vorkommen dieses Tag/Monats ab referenceDate genommen (liegt der
 * naheliegende Kandidat mehr als ~6 Monate in der Vergangenheit, wird stattdessen das
 * Folgejahr angenommen - wichtig für Mails kurz vor Silvester).
 */
function extractCheckInDate(text, referenceDate = new Date()) {
  const m = /Check-in[\s\S]{0,30}?(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)[\s\S]{0,20}?(\d{1,2}):(\d{2})/.exec(text || '');
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const month = DE_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  const hh = parseInt(m[3], 10);
  const mm = parseInt(m[4], 10);

  const year = referenceDate.getFullYear();
  let candidate = new Date(year, month, day, hh, mm);
  const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() < referenceDate.getTime() - sixMonthsMs) {
    candidate = new Date(year + 1, month, day, hh, mm);
  }
  return candidate;
}

/**
 * Freitextnachricht des Gasts (z.B. Wünsche zum früheren Check-in): steht zwischen der
 * Anrede-Zeile ("Hallo <Host>, ...") und dem Button-Text ("Sende ... eine Nachricht").
 * Optional - hat der Gast keine Nachricht mitgeschickt, liefert Airbnb diesen Abschnitt
 * gar nicht erst, dann gibt es hier auch nichts zu finden.
 */
function extractGuestNote(text) {
  const m = /Hallo[^\n]*\n([\s\S]{1,500}?)\n\s*Sende\s/i.exec(text || '');
  if (!m) return null;
  const note = m[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return note || null;
}

module.exports = {
  isBookingConfirmationEmail,
  extractConfirmationCode,
  extractGuestName,
  extractCheckInDate,
  extractGuestNote,
};
