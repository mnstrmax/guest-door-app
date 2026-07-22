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
// Verwendet wird nur der Vorname (erstes Wort) - persönlicher und kürzer für die
// Begrüßung in der App, genau wie Airbnb selbst in der Mail-Überschrift nur den Vornamen
// zeigt (z.B. "Selina kommt am 17. Juli an").
function extractGuestName(text, subject) {
  // Bewusst nur horizontaler Whitespace ([ \t]*, keine Newlines) zwischen Namenszeile und
  // "Identität verifiziert" - die beiden stehen im echten Mailtext direkt untereinander,
  // ohne Leerzeile dazwischen. Ein größeres Toleranzfenster hier würde sonst versehentlich
  // die Überschrift ("Neue Buchung bestätigt: NAME kommt am ...", die weiter oben in der
  // Mail steht) als Namenszeile erwischen, wenn dazwischen wenig Text steht.
  const bodyMatch = /\n([A-ZÄÖÜ][^\n]{1,60}?)\n[ \t]*Identit[aä]t verifiziert/.exec(text || '');
  let fullName = null;
  // Zusätzliche Absicherung: eine echte Namenszeile enthält nie "kommt am" oder
  // "Buchung bestätigt" - falls die Regex doch mal die Überschrift erwischt, wird das
  // hier verworfen und stattdessen der Betreffs-Fallback verwendet.
  if (bodyMatch && !/kommt am|Buchung best[aä]tigt/i.test(bodyMatch[1])) {
    fullName = bodyMatch[1].trim();
  }
  if (!fullName) {
    const subjMatch = /Buchung best[aä]tigt[\s\S]{0,5}?[:–-][\s\S]{0,3}?([A-ZÄÖÜ][^\n]{1,60}?)\s+kommt am/i.exec(
      subject || ''
    );
    if (subjMatch) fullName = subjMatch[1].trim();
  }
  if (!fullName) return null;
  return fullName.split(/\s+/)[0];
}

// Volle Monatsnamen UND gängige Abkürzungen (Airbnb schreibt in manchen Mails offenbar
// "28. Aug." statt "28. August" - ohne die Abkürzung schlägt die Erkennung dann komplett
// fehl, siehe extractCheckInDate). Der Regex-Capture enthält nie den abschließenden Punkt
// einer Abkürzung (nur Buchstaben), der muss hier also nicht mit aufgenommen werden.
const DE_MONTHS = {
  januar: 0,
  jan: 0,
  februar: 1,
  feb: 1,
  märz: 2,
  maerz: 2,
  mär: 2,
  mrz: 2,
  april: 3,
  apr: 3,
  mai: 4,
  juni: 5,
  jun: 5,
  juli: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  oktober: 9,
  okt: 9,
  november: 10,
  nov: 10,
  dezember: 11,
  dez: 11,
};

// Alternation aus allen bekannten Monatsnamen/-abkürzungen, längste zuerst (rein
// kosmetisch/unschädlich bei Gleichheit der Zuordnung) - als Anker für extractCheckInDate.
const MONTH_ALTERNATION = Object.keys(DE_MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * "Check-in\nFr., 17. Juli\n15:00" -> Date. Das Jahr steht nirgends in der Mail, deshalb
 * wird das nächste Vorkommen dieses Tag/Monats ab referenceDate genommen (liegt der
 * naheliegende Kandidat mehr als ~6 Monate in der Vergangenheit, wird stattdessen das
 * Folgejahr angenommen - wichtig für Mails kurz vor Silvester).
 *
 * Zwei Stolpersteine aus echten Mails (siehe Git-Historie/Bugreports), die diese Funktion
 * bewusst umschifft:
 * 1. "Check-in" kommt vorher schon in einem Fließtextsatz vor ("...Einzelheiten zum
 *    Check-in zu bestätigen..."), meist direkt gefolgt von einem langen Airbnb-Link.
 *    Ein per Zeichen-Anzahl begrenztes Suchfenster ab "Check-in" kann in diesem Link
 *    zufällig auf eine Ziffer treffen, oder (bei größerem Fenster) sogar auf eine
 *    zufällige Buchstabenfolge, die wie ein Monat aussieht. Deshalb wird hier nur noch
 *    nach TATSÄCHLICHEN Monatsnamen gesucht (MONTH_ALTERNATION), nicht nach beliebigen
 *    Buchstaben - Zufallstreffer in einer Tracking-URL sind damit praktisch ausgeschlossen.
 * 2. mailparser wandelt Airbnbs zweispaltige Check-in/Check-out-Tabelle in Text mit
 *    Leerzeichen-Ausrichtung um, inklusive einer reinen Leerzeichen-"Trennzeile"
 *    zwischen Überschrift und Werten (z.B. "Check-in       Check-out\n               \n
 *    Sa., 1. Aug.   So., 2. Aug."). Ein zu kleines Zeichenfenster verpasst das Datum
 *    dadurch komplett, ein zu großes würde stattdessen leicht das Check-out- statt das
 *    Check-in-Datum erwischen. Da die Check-in-Spalte im Text aber immer VOR der
 *    Check-out-Spalte steht, liefert eine unbegrenzte (aber auf echte Monatsnamen
 *    beschränkte) Suche ab "Check-in" automatisch den ersten - also linken, also
 *    Check-in - Treffer.
 */
function extractCheckInDate(text, referenceDate = new Date()) {
  if (!text) return null;
  const idx = text.indexOf('Check-in');
  if (idx === -1) return null;
  const rest = text.slice(idx);

  const dateMatch = new RegExp(`(\\d{1,2})\\.\\s*(${MONTH_ALTERNATION})\\b`, 'i').exec(rest);
  if (!dateMatch) return null;

  const day = parseInt(dateMatch[1], 10);
  const month = DE_MONTHS[dateMatch[2].toLowerCase()];
  if (month === undefined) return null;

  // Uhrzeit steht - durch dieselbe Leerzeichen-Trennzeilen-Eigenheit abgesetzt - kurz
  // danach in derselben (linken/Check-in-)Spalte. Bewusst ein kleines, aber großzügiges
  // Suchfenster (statt komplett unbegrenzt wie beim Datum), damit nicht irgendeine
  // spätere Uhrzeitangabe aus einem ganz anderen Mailabschnitt erwischt wird.
  const afterDateEnd = dateMatch.index + dateMatch[0].length;
  const timeWindow = rest.slice(afterDateEnd, afterDateEnd + 60);
  const timeMatch = /(\d{1,2}):(\d{2})/.exec(timeWindow);
  if (!timeMatch) return null;

  const hh = parseInt(timeMatch[1], 10);
  const mm = parseInt(timeMatch[2], 10);

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
