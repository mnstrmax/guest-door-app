const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('./config');
const { applyEmailEnrichment } = require('./guests');
const {
  isBookingConfirmationEmail,
  extractConfirmationCode,
  extractGuestName,
  extractCheckInDate,
  extractGuestNote,
} = require('./emailParse');

// Airbnb-Buchungsbestätigungsmails ändern sich selten und der Gast selbst braucht die
// Info aus dieser Mail nicht in Echtzeit - stündlich reicht, analog zum Kalender-Sync.
// Läuft bewusst NACH airbnbSync in server/index.js, damit ein per Kalender importierter
// Gast zum Zeitpunkt des Mail-Syncs im selben Durchlauf meist schon existiert.
const SYNC_INTERVAL_MS = 60 * 60 * 1000;

// Nur Mails der letzten X Tage durchsuchen - hält die IMAP-Suche schnell und alte, längst
// erledigte Buchungen werden nicht bei jedem Durchlauf erneut anfasst.
const SEARCH_WINDOW_DAYS = 30;

// Wie viele bereits verarbeitete Message-IDs maximal gemerkt werden (FIFO), damit die
// Statusdatei bei einem langlebigen Postfach nicht unbegrenzt wächst.
const MAX_PROCESSED_IDS = 500;

/**
 * Liest die Liste bereits verarbeiteter Message-IDs. Bewusst unabhängig vom "gelesen"-
 * Status im Postfach (IMAP-Flag \Seen) - der könnte sich auch durch einen ganz anderen,
 * parallel genutzten Mail-Client ändern (z.B. Vorschau am iPhone), was sonst dazu führen
 * würde, dass eine Buchungsmail nie verarbeitet wird, nur weil sie schon "gelesen" war.
 */
function loadProcessedIds() {
  try {
    const raw = fs.readFileSync(config.emailStateFile, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.processedMessageIds) ? data.processedMessageIds : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('[email-sync] Statusdatei konnte nicht gelesen werden:', err.message);
    return [];
  }
}

function saveProcessedIds(ids) {
  const trimmed = ids.slice(-MAX_PROCESSED_IDS);
  const dir = path.dirname(config.emailStateFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.emailStateFile, JSON.stringify({ processedMessageIds: trimmed }, null, 2) + '\n');
}

/**
 * Holt neue Airbnb-Buchungsbestätigungsmails per IMAP, extrahiert Gastname/Bestätigungscode/
 * Nachricht (siehe emailParse.js) und ergänzt damit passende, per Kalender-Sync importierte
 * Gäste, deren Name noch der Platzhalter "Airbnb-Gast" ist (siehe guests.applyEmailEnrichment).
 * Best-effort: IMAP-/Parse-Fehler landen nur im Log, blockieren nie den Rest der App.
 * @param {object} [ha] - HAClient-Instanz für Push-Benachrichtigungen (optional).
 */
async function runSync(ha) {
  if (!config.hasEmailSync) return { skipped: true };

  const processedIds = loadProcessedIds();
  const processedSet = new Set(processedIds);
  const newProcessedIds = [...processedIds];

  const client = new ImapFlow({
    host: config.emailImapHost,
    port: config.emailImapPort,
    secure: true,
    auth: { user: config.emailImapUser, pass: config.emailImapPassword },
    logger: false,
  });

  let checked = 0;
  let matched = 0;
  let skippedAlready = 0;

  try {
    await client.connect();
  } catch (err) {
    console.error('[email-sync] IMAP-Verbindung fehlgeschlagen:', err.message);
    return { error: err.message };
  }

  try {
    const lock = await client.getMailboxLock(config.emailImapMailbox);
    try {
      const since = new Date(Date.now() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      // Serverseitig bewusst nur nach Absender+Zeitraum filtern (ASCII-sicher). Ob es
      // tatsächlich eine Buchungsbestätigung ist (Betreff enthält "Buchung bestätigt"),
      // wird erst lokal nach dem Parsen geprüft - vermeidet Unicode-Sonderfälle in der
      // IMAP-SEARCH-Implementierung verschiedener Mail-Provider.
      const uids = await client.search({ from: 'airbnb.com', since }, { uid: true });

      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
          checked += 1;

          let parsed;
          try {
            parsed = await simpleParser(msg.source);
          } catch (err) {
            console.error('[email-sync] Mail konnte nicht geparst werden, überspringe:', err.message);
            continue;
          }

          const messageId = parsed.messageId || `uid-${msg.uid}`;
          if (processedSet.has(messageId)) {
            skippedAlready += 1;
            continue;
          }

          const subject = parsed.subject || '';
          const from = (parsed.from && parsed.from.text) || '';
          if (!isBookingConfirmationEmail({ subject, from })) {
            // Andere Airbnb-Mail (Nachricht, Erinnerung, Rezension o.ä.) - nicht relevant,
            // trotzdem als verarbeitet merken, damit sie nicht jedes Mal erneut geprüft wird.
            newProcessedIds.push(messageId);
            continue;
          }

          const text = parsed.text || '';
          const checkInDate = extractCheckInDate(text, parsed.date || new Date());
          if (!checkInDate) {
            console.warn(`[email-sync] Check-in-Datum in Mail "${subject}" nicht erkannt, überspringe.`);
            newProcessedIds.push(messageId);
            continue;
          }

          const name = extractGuestName(text, subject);
          const confirmationCode = extractConfirmationCode(text);
          const note = extractGuestNote(text);

          const enriched = applyEmailEnrichment({ checkInDate, name, confirmationCode, note });
          if (enriched) {
            matched += 1;
            newProcessedIds.push(messageId);
            if (ha) {
              const noteLine = note ? `\nNachricht: ${note}` : '';
              try {
                await ha.notify(config.notifyService, `Name ergänzt: ${enriched.name}.${noteLine}`, 'Guest Door App');
              } catch (err) {
                console.error('[email-sync] Benachrichtigung fehlgeschlagen:', err.message);
              }
            }
          } else {
            // Kein eindeutiger Treffer (z.B. Kalender-Sync ist noch nicht gelaufen, oder
            // mehrdeutig, weil mehrere Gäste am selben Tag anreisen). Mail bewusst NICHT
            // als verarbeitet markieren - der nächste Durchlauf versucht es erneut.
            console.warn(
              `[email-sync] Kein eindeutiger Gast für Check-in ${checkInDate.toDateString()} gefunden, ` +
                'versuche es beim nächsten Sync erneut.'
            );
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[email-sync] IMAP-Zugriff fehlgeschlagen:', err.message);
    saveProcessedIds(newProcessedIds);
    try {
      await client.logout();
    } catch {
      // Verbindung ohnehin schon defekt - egal.
    }
    return { error: err.message };
  }

  try {
    await client.logout();
  } catch (err) {
    console.warn('[email-sync] Sauberes Logout fehlgeschlagen (unkritisch):', err.message);
  }

  saveProcessedIds(newProcessedIds);

  const summary = { checked, matched, skippedAlready };
  console.log(
    `[email-sync] ${checked} Mail(s) geprüft, ${matched} Gast/Gäste ergänzt, ${skippedAlready} bereits bekannt.`
  );
  return summary;
}

function start(ha) {
  if (!config.hasEmailSync) return;
  console.log('[email-sync] E-Mail-Sync aktiviert (stündlich, plus einmal jetzt beim Start).');
  runSync(ha);
  setInterval(() => runSync(ha), SYNC_INTERVAL_MS);
}

module.exports = { start, runSync };
