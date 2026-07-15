# Guest Door App

Kleine WebApp für Airbnb-Gäste: PIN eingeben → einmal an der Ring-Gegensprechanlage
klingeln → Haustür öffnet sich automatisch (Ring Intercom) → Button für die
Wohnungstür (Nuki) drücken. Gastgeber bekommt bei jedem Schritt eine Push-Benachrichtigung.

## Automatischer Gäste-Import aus dem Airbnb-Kalender

Statt jeden Gast manuell in `/admin` anzulegen, kann die App neue Reservierungen
automatisch aus deinem privaten Airbnb-Kalender-Link importieren:

1. In Airbnb: **Kalender → Verfügbarkeit → "Mit anderer Website verbinden"** → Link
   kopieren (endet auf `.ics`).
2. Den Link bei `airbnb_ical_url` in der Add-on-Konfiguration eintragen.

Danach synchronisiert die App stündlich automatisch (plus einmal beim Start, und
jederzeit manuell über den Button in `/admin`). Pro Reservierung wird ein Gast angelegt
mit:

- **Check-in/Check-out**: aus dem Kalender, kombiniert mit `default_checkin_time` /
  `default_checkout_time` (Airbnb liefert nur das Datum, keine Uhrzeit; Standard 15:00/11:00).
- **PIN**: die letzten 4 Ziffern der Telefonnummer, die Airbnb selbst seit 2019 im
  Kalender-Export mitliefert (aus Datenschutzgründen keine vollständige Nummer und kein
  Name mehr). Der Gast kennt seine eigene Nummer also bereits - du musst nichts extra
  mitteilen.
- **Name**: Airbnb liefert keinen Namen mehr, daher zunächst der Platzhalter
  "Airbnb-Gast" (in der Gästeliste mit Hinweis-Badge markiert). Trag den echten Namen in
  `/admin` nach, falls du die persönliche Begrüßung möchtest - spätere Syncs
  überschreiben deine Korrektur nicht wieder. Für jeden neu importierten Gast kommt
  eine Push-Benachrichtigung (Check-in-Datum + PIN) als Erinnerung, den Namen zu ergänzen.
- Rein manuell blockierte Kalendertage (ohne echte Buchung) haben keine Telefonnummer im
  Feed und werden automatisch übersprungen, es wird kein Gast dafür angelegt.

Storniert ein Gast seine Reservierung auf Airbnb, erkennt der nächste Sync das (die
Reservierung verschwindet aus dem Feed) und setzt die PIN sofort ungültig - der Eintrag
bleibt aber sichtbar in der Liste, statt automatisch gelöscht zu werden. Manuell über
`/admin` angelegte Gäste fasst der Sync nie an.

**Der Kalender-Link ist geheim** wie ein Passwort (er verrät Buchungszeiträume) und wird
genau wie alle anderen persönlichen Werte nur in der Add-on-Konfiguration bzw. `.env`
gespeichert, nie im Quellcode/Git.

## E-Mail-Sync: Namen automatisch aus Buchungsmails ergänzen

Der Kalender-Import (siehe oben) liefert keinen Gastnamen und keine Nachrichten des
Gasts - beides steht aber in der Buchungsbestätigungsmail, die Airbnb bei jeder neuen
Reservierung verschickt. Ist ein IMAP-Postfach konfiguriert, sucht die App dort stündlich
danach und ergänzt automatisch importierte Gäste, deren Name noch der Platzhalter
"Airbnb-Gast" ist:

1. In der Add-on-Konfiguration eintragen: `email_imap_host` (z. B. `imap.gmail.com`),
   `email_imap_user`, `email_imap_password` (bei Postfächern mit 2FA ein App-Passwort
   verwenden, das normale Passwort funktioniert dann meist nicht per IMAP), optional
   `email_imap_port` (Standard `993`) und `email_imap_mailbox` (Standard `INBOX`).
2. Fertig - die App durchsucht ab dem nächsten Sync automatisch die letzten 30 Tage im
   Postfach nach Buchungsbestätigungsmails (auch manuell über den Button in `/admin`
   anstoßbar).

Erkannt wird eine Buchungsbestätigung ausschließlich am **Betreff** (enthält "Buchung
bestätigt"), nicht am Absender - das funktioniert also genauso, wenn du die Mails manuell
aus deinem normalen Postfach in das dedizierte weiterleitest (dann bist selbst du der
Absender, nur der Betreff bekommt ein "Fwd:"-Präfix, das nicht stört) wie auch bei einer
serverseitigen Weiterleitungsregel, die den ursprünglichen Absender erhält. Wichtig beim
manuellen Weiterleiten: **inline weiterleiten**, nicht "als Anhang" - die Erkennung von
Name/Datum/Nachricht braucht den ursprünglichen Mailinhalt direkt im Text, nicht als
angehängte `.eml`-Datei.

Aus jeder passenden Mail werden extrahiert: der Vorname des Gasts, Airbnbs
Bestätigungscode und eine eventuelle Freitextnachricht des Gasts (z. B. ein Wunsch nach
früherem Check-in) - letztere erscheint als Notiz unter dem Namen in `/admin` und geht
per Push an dich raus, du entscheidest selbst, ob und wie du darauf reagierst (die App
ändert Check-in-Zeiten nie automatisch anhand einer Freitextnachricht).

Die Zuordnung zu einem Gast passiert über den Check-in-Kalendertag: Gibt es dafür
**genau einen** per Kalender-Sync importierten Gast mit noch unverändertem Platzhalter-
Namen, wird dieser ergänzt. Bei Mehrdeutigkeit (z. B. zwei Anreisen am selben Tag) oder
wenn der Kalender-Sync die Reservierung noch nicht angelegt hat, passiert bewusst nichts
- die Mail wird beim nächsten Durchlauf erneut geprüft, statt riskiert, den falschen
Gast zu beschriften. Jede Mail wird nur einmal verarbeitet (unabhängig vom
"gelesen"-Status im Postfach, den z. B. auch die Mail-App auf deinem iPhone verändern
könnte).

Optional (`email_delete_after_sync`, Standard aus) löscht die App eine Buchungsmail per
IMAP, sobald sie erfolgreich einem Gast zugeordnet wurde - Mails ohne eindeutigen Treffer
werden nie gelöscht, nur was tatsächlich verarbeitet wurde. Je nach Mail-Provider landet
die Mail dabei sofort endgültig im Nirwana oder zunächst noch im Papierkorb (z. B. räumt
Gmail seinen Papierkorb automatisch nach 30 Tagen leer) - im Zweifel beim eigenen
Provider nachsehen, wie lange gelöschte Mails dort wiederherstellbar bleiben.

**Die IMAP-Zugangsdaten sind geheim** wie jedes andere Passwort und landen nie im
Quellcode/Git, nur in der Add-on-Konfiguration bzw. `.env`. Ohne konfiguriertes Postfach
bleibt dieses Feature komplett inaktiv, der Name muss dann weiterhin manuell in `/admin`
nachgetragen werden.

## Rückkehrgäste: Menü statt erneutem Klingel-Ablauf

Sobald ein Gast den kompletten Ablauf einmal durchlaufen und am Ende auf **"Alles in
Ordnung"** getippt hat, wird er dafür in der Gästedatei als eingecheckt markiert (nur
intern, keine Konfiguration nötig). Meldet er sich danach erneut mit seiner PIN an,
bekommt er - sofern eine Zimmersteuerung konfiguriert ist (siehe unten) - statt des
Klingel-Ablaufs ein Menü mit zwei Optionen:

- **Türen nochmal öffnen**: startet den normalen Ablauf erneut (Klingeln → Haustür →
  Wohnungstür), z. B. wenn der Gast nochmal rausgegangen ist.
- **Zimmer steuern**: öffnet die Zimmersteuerung (Heizung + Lichter, siehe unten).

Ist keine Zimmersteuerung konfiguriert, gibt es kein Menü - Rückkehrgäste durchlaufen
dann weiterhin einfach den normalen Klingel-Ablauf wie beim ersten Mal.

Der Bestätigungs-Button am Ende schickt außerdem eine Push-Benachrichtigung an dich.

Drückt ein Gast diesen Button nicht (kommt vor), lässt sich das in `/admin` manuell
nachtragen: Bei einem noch nicht bestätigten Gast erscheint der Button **"Alles OK
markieren"** in der Aktionen-Spalte - setzt denselben Status wie der reguläre Button in
der App, danach bekommt der Gast bei erneuter PIN-Eingabe korrekt das Rückkehrgast-Menü.

## Gästeliste in /admin: Heute, Anstehend, Abgelaufen

Die Gästeliste ist in drei Bereiche unterteilt: **Heute** (der Aufenthalt überschneidet
sich mit dem heutigen Tag - Anreise, Abreise oder mittendrin), **Anstehend** (Check-in
liegt in der Zukunft, sortiert nach Anreisedatum) und **Abgelaufen** (Check-out liegt in
der Vergangenheit, sortiert nach Abreisedatum, neueste zuerst). Der abgelaufene Bereich
ist standardmäßig eingeklappt, damit die Liste übersichtlich bleibt, ohne die Historie
wegzuwerfen - ein Klick auf "Abgelaufen (n)" klappt ihn auf.

Reist ein Gast schon vor dem eigentlich hinterlegten Check-out ab, lässt sich das über
den Button **"Bereits ausgecheckt"** nachtragen (nur sichtbar, solange der Gast gerade
aktiv ist, also die PIN gerade gültig ist). Setzt den Check-out auf den aktuellen
Zeitpunkt, macht die PIN damit sofort ungültig und der Gast wandert beim nächsten Laden
nach "Abgelaufen".

Die laufende Version steht oben rechts im Admin-Panel - praktisch, um nach einem Update
auf einen Blick zu erkennen, ob es tatsächlich angekommen ist.

## Zimmersteuerung (Heizung + Lichter) für Rückkehrgäste

Optional können Gäste im Rückkehrgast-Menü die Heizung sowie zwei Lichter im Zimmer
selbst steuern. Dazu im Konfigurations-Tab eintragen (alle drei optional - nur
konfigurierte Geräte erscheinen, ist keins gesetzt, entfällt das Menü komplett):

- `guestroom_climate_entity_id`: die `climate.*`-Entity der Heizung. Gast kann die
  Zieltemperatur in 0,5°C-Schritten anpassen.
- `guestroom_ceiling_light_entity_id`: `light.*`-Entity des Deckenlichts.
- `guestroom_floor_light_entity_id`: `light.*`-Entity des Bodenlichts/der Stehlampe.

Beide Lichter lassen sich unabhängig voneinander an-/ausschalten.

## Sprachen

Das Gäste-Frontend ist mehrsprachig: **Deutsch, Englisch, Französisch, Spanisch**.
Die Sprache wird automatisch anhand der Browser-/Gerätesprache des Gasts erkannt,
zusätzlich gibt es oben auf der Seite einen manuellen Umschalter (DE/EN/FR/ES).
Übersetzungen liegen in `public/i18n.js`. Die `/admin`-Seite bleibt bewusst nur
Deutsch (nur für dich als Gastgeber gedacht).

`bell_label` (der Name auf dem Klingelschild) ist ein Eigenname und wird **nicht**
übersetzt – er erscheint in jeder Sprache unverändert. Stockwerk und Zimmer werden
dagegen **nicht** als Freitext eingetragen, sondern strukturiert (`apartment_floor`,
`apartment_side`, `room_number`, `room_side` – siehe Konfigurationsschritte unten).
Daraus baut die App in jeder Sprache automatisch einen korrekt übersetzten Satz,
z. B. "3. Obergeschoss rechts" / "3rd floor, on the right" / "3e étage, à droite" /
"3ª planta, a la derecha". Lässt du sie leer, fällt die App auf generische Sätze ohne
diese Details zurück.

## ⚠️ Update auf 1.8.0: Neue Abhängigkeiten für den E-Mail-Sync

Für den optionalen E-Mail-Sync (siehe oben) kommen erstmals zwei zusätzliche
npm-Pakete dazu (`imapflow`, `mailparser`) - bisher kam die App bewusst mit nur drei
minimalen Abhängigkeiten aus. Ein IMAP-Client und E-Mail-Parser von Grund auf selbst zu
bauen wäre bei der Vielfalt realer Postfach-/MIME-Eigenheiten deutlich fehleranfälliger
gewesen als bei den bisherigen selbstgebauten Teilen (iCal, TOTP) - deshalb hier bewusst
auf bewährte, weit verbreitete Bibliotheken gesetzt.

- **Standalone (Docker Compose/`npm start`)**: nach dem Update einmal `npm install`
  erneut ausführen (bzw. bei Docker Compose reicht `docker compose up -d --build`, das
  baut das Image mit den neuen Abhängigkeiten neu).
- **Home Assistant Add-on**: keine Aktion nötig, der Supervisor baut das Image beim
  Add-on-Update automatisch neu (`npm install` läuft im Dockerfile).

Ohne konfiguriertes IMAP-Postfach (`email_imap_host`/`-user`/`-password`) ändert sich
am Verhalten sonst nichts - das Feature ist rein additiv und standardmäßig inaktiv.

## ⚠️ Update auf 1.7.0: Admin-Login jetzt mit Session + optionaler 2FA

Die `/admin`-Seite verwendet nicht mehr HTTP Basic Auth, sondern eine echte
Login-Seite (`/admin/login`) mit Session-Cookie (läuft nach 12 Stunden automatisch ab).
**Im Browser gespeicherte Basic-Auth-Zugangsdaten funktionieren nach dem Update nicht
mehr** – einmalig neu über `/admin/login` einloggen.

- Der Benutzername ist jetzt frei wählbar über die neue Option `admin_username`
  (Standalone: `ADMIN_USERNAME`). Ist sie leer, gilt weiterhin `admin` als Benutzername,
  genau wie bisher jeder beliebige Benutzername akzeptiert wurde.
- Optional lässt sich Zwei-Faktor-Authentifizierung (2FA) aktivieren: einmal ohne 2FA
  einloggen, in `/admin` unter "Zwei-Faktor-Authentifizierung" auf "Neuen Code
  generieren" klicken, den Secret-Key in eine Authenticator-App scannen/eintragen
  **und** in die Option `admin_totp_secret` (Standalone: `ADMIN_TOTP_SECRET`)
  eintragen, danach Add-on/Server neu starten. Ab dann verlangt der Login zusätzlich
  den 6-stelligen Code aus der App. Leer lassen = 2FA bleibt deaktiviert.
- Login-Versuche auf `/admin/login` sind eigens begrenzt (5 Fehlversuche / 15 Minuten,
  pro IP und global), unabhängig vom PIN-Rate-Limit für Gäste. Ein fehlgeschlagener
  Admin-Login löst wie ein fehlgeschlagener PIN-Versuch eine Push-Benachrichtigung aus.

## ⚠️ Update auf 1.4.0: Stockwerk/Zimmer jetzt strukturiert statt Freitext

Die Optionen `apartment_location` und `room_location` gibt es nicht mehr. Stattdessen:
`apartment_floor`, `apartment_side`, `room_number`, `room_side` (siehe Abschnitt
"Fotos & persönliche Texte"). Grund: nur so kann die App die Angabe in jeder Sprache
korrekt übersetzen. **Nach dem Update müssen diese vier Felder im Konfigurations-Tab
einmalig neu eingetragen werden**, die alten Freitext-Werte werden nicht übernommen.

## ⚠️ Update auf 1.1.0: Gäste-Verwaltung geändert

Gäste werden nicht mehr über die Add-on-Konfiguration (Option `guests`) verwaltet,
sondern über eine neue, passwortgeschützte **`/admin`-Seite** mit echtem
Datum/Zeit-Picker (die HA-Add-on-Konfiguration kann so etwas nicht abbilden).
**Nach dem Update müssen bestehende Gäste einmalig neu über `/admin` angelegt
werden** – alte Einträge aus der Konfiguration werden nicht automatisch übernommen.

## Fotos & persönliche Texte

Fotos (Wohnungstür, Zimmer) sowie Freitexte wie der Name auf dem Klingelschild oder
die Zimmer-Beschreibung landen **nie im Git-Repository** – sonst wären sie auf GitHub
öffentlich einsehbar. Stattdessen:

- Fotos: lokal ablegen (Add-on: `/config/guest-door-app-images/`, z. B. per "File editor"-
  Add-on hochladbar; Standalone: `images/`-Ordner im Projekt, per `.gitignore`
  ausgeschlossen) – siehe `images/README.md`.
- Texte/Werte (`bell_label`, `apartment_floor`, `apartment_side`, `room_number`,
  `room_side`): nur über die Add-on-Konfiguration bzw. `.env` gesetzt, nie im Quellcode.

## Eigene Klingel-Automation nicht doppelt benachrichtigen lassen

Wenn du zusätzlich eine eigene HA-Automation hast, die bei jedem Klingeln (unabhängig
von dieser App) eine Push-Nachricht schickt, würde die auch dann auslösen, wenn ein
Gast über die App klingelt – die App reagiert auf denselben Sensor. Um das zu
vermeiden:

1. In Home Assistant unter **Einstellungen → Geräte & Dienste → Helfer** einen neuen
   **Ein/Aus-Schalter** (`input_boolean`) anlegen, z. B. `input_boolean.gastapp_wartet_auf_klingel`.
2. Diese Entity-ID bei `app_active_entity_id` in der Add-on-Konfiguration eintragen.
   Die App setzt sie automatisch auf `on`, solange sie auf ein Klingeln wartet, und
   wieder auf `off`, sobald das erledigt ist (mit Sicherheitsnetz, falls ein Gast nie
   klingelt).
3. In deiner eigenen Automation als zusätzliche Bedingung ergänzen:

   ```yaml
   conditions:
     - condition: state
       entity_id: input_boolean.gastapp_wartet_auf_klingel
       state: "off"
   ```

   Dann feuert deine Automation nur noch bei "organischen" Klingeln (Postbote, Besuch
   ohne App), nicht wenn die App selbst gerade einen Gast durchlässt.

## Ablauf

1. Gast öffnet die Seite und gibt seine PIN ein. Bei Erfolg wird er mit Namen begrüßt,
   der Gastgeber bekommt eine Benachrichtigung.
2. Gast wird angewiesen, einmal zu klingeln. Der Server hört per Home-Assistant-
   WebSocket in Echtzeit auf den konfigurierten Klingel-Sensor.
3. Klingelt jemand, während eine gültige Session aktiv ist, ruft der Server automatisch
   den Ring-Intercom-Service auf und öffnet die Haustür. Klingelt jemand ohne aktive
   Session (z. B. Postbote), passiert nichts. Gastgeber wird benachrichtigt.
4. Sobald die Haustür offen ist, sieht der Gast ein Foto der Wohnungstür + Wegbeschreibung,
   dann den Button "Wohnungstür öffnen" (Nuki). Optional gehen dabei konfigurierte
   Lichter automatisch an. Gastgeber wird benachrichtigt.
5. Gast sieht ein Foto seines Zimmers zur Orientierung und bestätigt am Ende mit
   **"Alles in Ordnung"** - Gastgeber wird benachrichtigt, Gast gilt ab jetzt als
   eingecheckt.
6. Meldet sich derselbe Gast später erneut mit seiner PIN an, bekommt er (falls
   Zimmersteuerung konfiguriert ist) ein Menü: Türen nochmal öffnen oder Zimmer
   steuern (Heizung, Lichter) - siehe "Rückkehrgäste" oben.

## Voraussetzungen in Home Assistant

- Offizielle **Ring**-Integration mit eingebundenem Ring Intercom (erscheint als
  `lock.*`-Entity) sowie einem Klingel-/"Ding"-Sensor (`binary_sensor.*`).
- Offizielle **Nuki**-Integration mit dem Smart Lock als `lock.*`-Entity.
- Für Add-on-Modus: Home Assistant OS oder Supervised. Für Standalone: ein
  **Long-Lived Access Token** (Profil → Sicherheit → Langlebige Zugriffstoken).
- Für Benachrichtigungen (optional): Home Assistant Companion App auf dem Handy,
  dadurch existiert ein `notify.mobile_app_<gerätename>`-Service.

### Entity-IDs finden

In Home Assistant unter **Entwicklerwerkzeuge → Zustände**:

- Klingel-Sensor: nach "ding" oder dem Gerätenamen filtern. Der Zustand muss beim
  Klingeln kurz auf `on` wechseln.
- Ring Intercom: Domain `lock`.
- Nuki: Domain `lock`.
- Notify-Service: **Entwicklerwerkzeuge → Aktionen**, nach "notify" suchen – der Teil
  nach "notify." ist der gesuchte Wert (z. B. `mobile_app_iphone`).

Falls unsicher, in **Entwicklerwerkzeuge → Ereignisse** auf `state_changed` abonnieren
und einmal testweise klingeln – die Entity-ID erscheint im Log.

Die App erkennt selbst, ob sie als eigenständiger Docker-Container (`.env` +
lokale Gästedatei) oder als Home Assistant Add-on (Konfiguration über die
HA-Oberfläche, kein Token nötig) läuft. Beide Wege sind unten beschrieben.

## Option A: Eigenständig per Docker Compose

1. `.env.example` nach `.env` kopieren und ausfüllen (HA-URL, Token, Entity-IDs,
   `ADMIN_PASSWORD` ist Pflicht).
2. Starten:

   ```
   docker compose up -d --build
   ```

   Ohne Docker: `npm install && npm start`.

3. App unter `http://<server-ip>:3000` aufrufen, Gäste unter
   `http://<server-ip>:3000/admin` anlegen (Login über `/admin/login`: Benutzername =
   `ADMIN_USERNAME` bzw. `admin`, Passwort = `ADMIN_PASSWORD`, optional 2FA-Code – siehe
   Abschnitt "Update auf 1.7.0").

## Option B: Als Home Assistant Add-on (Supervised / HA OS)

**Empfohlen: über ein GitHub-Add-on-Repository.** Dieser Ordner ist bereits Teil eines
solchen Repos (siehe `../README.md` im übergeordneten Ordner) – dort steht die
Anleitung zum Pushen nach GitHub und Einbinden über **Einstellungen → Add-ons →
Add-on Store → ⋮ → Repositories**. Danach direkt mit Schritt 3 unten weitermachen.

**Alternativ: lokale Kopie ohne GitHub.**

1. Den kompletten Ordner `guest-door-app` (inkl. `config.yaml` und `Dockerfile`) auf den
   Home-Assistant-Host nach `/addons/local/guest-door-app` kopieren, z. B. über das
   **Samba**- oder **SSH & Terminal**-Add-on. `.env` und `guests.json`/`guests.json.example`
   werden im Add-on-Modus nicht verwendet.
2. In Home Assistant: **Einstellungen → Add-ons → Add-on Store** → oben rechts "⋮" →
   **"Repositories prüfen"** (bzw. Seite neu laden), damit der neue Ordner unter
   "Lokale Add-ons" erscheint.
3. Add-on **"Guest Door App"** öffnen → **Installieren**.
4. Im Tab **Konfiguration** eintragen: `doorbell_entity_id`, `ring_intercom_entity_id`,
   `ring_intercom_service`, `nuki_entity_id`, `nuki_service`, `admin_password`
   (Pflicht – schützt die Gäste-Verwaltung), optional
   `hallway_light_entity_id`/`guestroom_light_entity_id`, `bell_label`,
   `apartment_floor` (Zahl, 0 = Erdgeschoss), `apartment_side`
   (`links`/`rechts`/`mitte`, auch `left`/`right`/`middle`), `room_number` (Zahl) und
   `room_side` (wie `apartment_side`), `notify_service` (z. B.
   `mobile_app_iphone17_von_max` für Push-Benachrichtigungen),
   `app_active_entity_id` (siehe Abschnitt "Eigene Klingel-Automation nicht doppelt
   benachrichtigen lassen"), `guestroom_climate_entity_id`/
   `guestroom_ceiling_light_entity_id`/`guestroom_floor_light_entity_id` (siehe
   Abschnitt "Zimmersteuerung") sowie `airbnb_ical_url`/`default_checkin_time`/
   `default_checkout_time` (siehe Abschnitt "Automatischer Gäste-Import"),
   `email_imap_host`/`email_imap_user`/`email_imap_password`/`email_imap_mailbox` (siehe
   Abschnitt "E-Mail-Sync") sowie optional `admin_username` (Standard `admin`) und
   `admin_totp_secret` für 2FA (siehe Abschnitt "Update auf 1.7.0") – alles direkt über
   die HA-Oberfläche, kein manuelles Token nötig (der Supervisor stellt automatisch
   Zugriff auf die Core-API bereit).
5. Add-on **starten**. Web-UI unter `http://<home-assistant-ip>:3000`, Gäste-Verwaltung
   unter `http://<home-assistant-ip>:3000/admin` (Login über `/admin/login`: Benutzername
   = `admin_username` bzw. `admin`, Passwort = `admin_password`, optional 2FA-Code).
6. Nach Änderungen an Entity-IDs/Texten im Konfigurations-Tab muss das Add-on
   **neu gestartet** werden. Gäste über `/admin` wirken sofort, ohne Neustart.

Für externen Zugriff (Gäste von unterwegs) weiterhin einen Reverse Proxy mit HTTPS
davorschalten – siehe Sicherheitshinweise.

## Sicherheitshinweise

- **HTTPS**: Wenn die App von außerhalb des lokalen Netzes erreichbar sein soll
  (z. B. für anreisende Gäste), unbedingt einen Reverse Proxy mit HTTPS davorschalten
  (z. B. Caddy, Traefik, nginx + Let's Encrypt), da sonst PIN und Admin-Passwort im
  Klartext übertragen werden.
- PIN-Eingaben sind doppelt begrenzt: max. 8 Versuche / 15 Minuten pro IP-Adresse
  **und zusätzlich** max. 8 Fehlversuche / 15 Minuten insgesamt, egal von welcher IP.
  Das zweite Limit verhindert, dass jemand das IP-Limit einfach durch viele
  verschiedene Absender-IPs umgeht (bei nur 4-stelligen PINs die eigentlich wirksame
  Bremse gegen verteiltes Brute-Forcing). Löst das globale Limit aus, wirst du einmalig
  per Push benachrichtigt.
- Gäste-Sessions laufen nach 2 Stunden automatisch ab.
- Der HA-Token liegt nur serverseitig (`.env` bzw. vom Supervisor injiziert) und wird
  nie an den Browser gesendet.
- Die `/admin`-Seite ist über eine eigene Login-Seite (`/admin/login`) mit
  Session-Cookie geschützt (`admin_username`/`admin_password`, Session läuft nach
  12 Stunden automatisch ab). Optional lässt sich zusätzlich Zwei-Faktor-Authentifizierung
  (TOTP, `admin_totp_secret`) aktivieren – siehe Abschnitt "Update auf 1.7.0". Admin-Logins
  sind eigens auf 5 Fehlversuche / 15 Minuten begrenzt (pro IP und global), unabhängig vom
  PIN-Rate-Limit; ein Fehlversuch löst eine Push-Benachrichtigung aus. Ohne HTTPS
  davorgeschaltet ist das nur für den Einsatz im vertrauenswürdigen lokalen Netz gedacht.
- Die Haustür öffnet sich ausschließlich, wenn zuvor eine gültige PIN eingegeben wurde
  **und** danach geklingelt wird – ein Klingeln allein öffnet nichts.
- Der E-Mail-Sync verbindet sich per TLS (Port 993) mit dem konfigurierten Postfach und
  liest dort nur Absender/Betreff/Text der zuletzt eingegangenen Mails - schreibt oder
  löscht nichts. Ein aus einer Buchungsmail erkannter Name/Notiz wird nur übernommen,
  wenn sich der Check-in-Tag eindeutig genau einem bereits per Kalender importierten,
  noch unbenannten Gast zuordnen lässt (siehe Abschnitt "E-Mail-Sync") - bei
  Mehrdeutigkeit passiert nichts automatisch.

## Anpassungen

- `RING_INTERCOM_SERVICE` / `NUKI_SERVICE`: falls dein Türsystem statt `unlock` den
  Service `open` unterstützt und du das bevorzugst, hier eintragen.
- Session-Dauer: `SESSION_TTL_MS` in `server/sessions.js`.
- Rate-Limit: `MAX_ATTEMPTS` / `WINDOW_MS` in `server/rateLimiter.js`.
