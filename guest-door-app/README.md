# Guest Door App

Kleine WebApp für Airbnb-Gäste: PIN eingeben → einmal an der Ring-Gegensprechanlage
klingeln → Haustür öffnet sich automatisch (Ring Intercom) → Button für die
Wohnungstür (Nuki) drücken. Gastgeber bekommt bei jedem Schritt eine Push-Benachrichtigung.

## Sprachen

Das Gäste-Frontend ist mehrsprachig: **Deutsch, Englisch, Französisch, Spanisch**.
Die Sprache wird automatisch anhand der Browser-/Gerätesprache des Gasts erkannt,
zusätzlich gibt es oben auf der Seite einen manuellen Umschalter (DE/EN/FR/ES).
Übersetzungen liegen in `public/i18n.js`. Die `/admin`-Seite bleibt bewusst nur
Deutsch (nur für dich als Gastgeber gedacht).

Die frei konfigurierbaren Texte (`bell_label`, `apartment_location`, `room_location`)
werden **nicht** automatisch übersetzt – sie erscheinen in jeder Sprache so, wie du sie
in der Add-on-Konfiguration eingetragen hast. Tipp: kurz und möglichst sprachneutral
halten (z. B. Eigennamen, Zahlen) oder bewusst weglassen, dann fällt die App auf
generische, bereits übersetzte Standardsätze zurück.

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
- Texte (`bell_label`, `apartment_location`, `room_location`): nur über die
  Add-on-Konfiguration bzw. `.env` gesetzt, nie im Quellcode.

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
5. Gast sieht ein Foto seines Zimmers zur Orientierung.

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
   `http://<server-ip>:3000/admin` anlegen (Login: beliebiger Benutzername,
   Passwort = `ADMIN_PASSWORD`).

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
   `apartment_location`, `room_location` sowie `notify_service` (z. B.
   `mobile_app_iphone17_von_max` für Push-Benachrichtigungen) – alles direkt über die
   HA-Oberfläche, kein manuelles Token nötig (der Supervisor stellt automatisch
   Zugriff auf die Core-API bereit).
5. Add-on **starten**. Web-UI unter `http://<home-assistant-ip>:3000`, Gäste-Verwaltung
   unter `http://<home-assistant-ip>:3000/admin` (Login mit beliebigem Benutzernamen,
   Passwort = `admin_password`).
6. Nach Änderungen an Entity-IDs/Texten im Konfigurations-Tab muss das Add-on
   **neu gestartet** werden. Gäste über `/admin` wirken sofort, ohne Neustart.

Für externen Zugriff (Gäste von unterwegs) weiterhin einen Reverse Proxy mit HTTPS
davorschalten – siehe Sicherheitshinweise.

## Sicherheitshinweise

- **HTTPS**: Wenn die App von außerhalb des lokalen Netzes erreichbar sein soll
  (z. B. für anreisende Gäste), unbedingt einen Reverse Proxy mit HTTPS davorschalten
  (z. B. Caddy, Traefik, nginx + Let's Encrypt), da sonst PIN und Admin-Passwort im
  Klartext übertragen werden.
- PIN-Eingaben werden pro IP-Adresse begrenzt (max. 8 Versuche / 15 Minuten).
- Sessions laufen nach 2 Stunden automatisch ab.
- Der HA-Token liegt nur serverseitig (`.env` bzw. vom Supervisor injiziert) und wird
  nie an den Browser gesendet.
- Die `/admin`-Seite ist per HTTP Basic Auth geschützt (`admin_password`). Ohne HTTPS
  davorgeschaltet ist das nur für den Einsatz im vertrauenswürdigen lokalen Netz gedacht.
- Die Haustür öffnet sich ausschließlich, wenn zuvor eine gültige PIN eingegeben wurde
  **und** danach geklingelt wird – ein Klingeln allein öffnet nichts.

## Anpassungen

- `RING_INTERCOM_SERVICE` / `NUKI_SERVICE`: falls dein Türsystem statt `unlock` den
  Service `open` unterstützt und du das bevorzugst, hier eintragen.
- Session-Dauer: `SESSION_TTL_MS` in `server/sessions.js`.
- Rate-Limit: `MAX_ATTEMPTS` / `WINDOW_MS` in `server/rateLimiter.js`.
