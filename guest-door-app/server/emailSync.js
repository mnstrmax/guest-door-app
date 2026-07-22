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
  let deleted = 0;
  // UIDs erfolgreich verarbeiteter Mails werden nur gesammelt und ERST NACH der
  // fetch()-Schleife gelöscht (siehe unten) - ImapFlow warnt ausdrücklich davor, während
  // eines laufenden fetch() weitere IMAP-Befehle abzusetzen (Deadlock-Gefahr).
  const uidsToDelete = [];

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
      // Serverseitig bewusst nur nach Zeitraum filtern, ohne Absender-Einschränkung: Wird
      // die Buchungsmail manuell weitergeleitet (siehe README, empfohlener Weg für ein
      // dediziertes Postfach), steht dort der eigene Absender, nicht mehr Airbnb selbst.
      // Ob es tatsächlich eine Buchungsbestätigung ist, wird erst lokal nach dem Parsen
      // anhand des Betreffs geprüft (siehe emailParse.isBookingConfirmationEmail) -
      // vermeidet außerdem Unicode-Sonderfälle in der IMAP-SEARCH-Implementierung
      // verschiedener Mail-Provider. In einem dafür dedizierten Postfach ist der Verzicht
      // auf den Absender-Filter unbedenklich.
      const uids = await client.search({ since }, { uid: true });

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
            // Bewusst NICHT als verarbeitet markieren (anders als früher) - anders als bei
            // "keine Buchungsbestätigung" (oben) ist das hier potenziell ein behebbarer
            // Parser-Fehler (z.B. ein Monatsformat, das emailParse.js noch nicht kennt).
            // Ein späterer Sync nach einem Parser-Update soll die Mail dann erneut
            // versuchen können, statt sie für immer zu ignorieren.
            console.warn(`[email-sync] Check-in-Datum in Mail "${subject}" nicht erkannt, überspringe.`);
            // Diagnose: der tatsächliche, von mailparser aus der Roh-Mail extrahierte Text
            // unterscheidet sich teils vom Text, den ein PDF-Export (z.B. "Gmail drucken")
            // zeigt - JSON.stringify macht dabei auch unsichtbare Zeichen/Zeilenumbrüche
            // sichtbar, die im PDF nicht auffallen würden.
            const idx = text.indexOf('Check-in');
            console.warn(
              idx === -1
                ? '[email-sync] "Check-in" kommt im extrahierten Mailtext gar nicht vor.'
                : `[email-sync] Textausschnitt zur Diagnose: ${JSON.stringify(text.slice(idx, idx + 80))}`
            );
            continue;
          }

          const name = extractGuestName(text, subject);
          const confirmationCode = extractConfirmationCode(text);
          const note = extractGuestNote(text);

          const enriched = applyEmailEnrichment({ checkInDate, name, confirmationCode, note });
          if (enriched) {
            matched += 1;
            newProcessedIds.push(messageId);
            // Nur erfolgreich zugeordnete Mails werden zum Löschen vorgemerkt - Mails ohne
            // eindeutigen Treffer bleiben unangetastet, damit ein späterer Sync sie erneut
            // versuchen kann (siehe else-Zweig unten).
            if (config.emailDeleteAfterSync) uidsToDelete.push(msg.uid);
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

      // Löschen erst hier, NACH der fetch()-Schleife (siehe Warnung oben) und noch
      // innerhalb desselben Mailbox-Locks. Best-effort: schlägt das Löschen fehl (z.B.
      // Provider-Eigenheit), ist das kein Grund, den ganzen Sync als fehlgeschlagen zu
      // werten - die Gäste-Daten sind zu diesem Zeitpunkt bereits erfolgreich ergänzt.
      if (uidsToDelete.length) {
        try {
          await client.messageDelete(uidsToDelete, { uid: true });
          deleted = uidsToDelete.length;
        } catch (err) {
          console.error('[email-sync] Löschen verarbeiteter Mails fehlgeschlagen:', err.message);
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

  const summary = { checked, matched, skippedAlready, deleted };
  console.log(
    `[email-sync] ${checked} Mail(s) geprüft, ${matched} Gast/Gäste ergänzt, ${skippedAlready} bereits bekannt` +
      (config.emailDeleteAfterSync ? `, ${deleted} Mail(s) gelöscht.` : '.')
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
