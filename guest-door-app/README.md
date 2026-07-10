# Guest Door App

Kleine WebApp für Airbnb-Gäste: PIN eingeben → einmal an der Ring-Gegensprechanlage
klingeln → Haustür öffnet sich automatisch (Ring Intercom) → Button für die
Wohnungstür (Nuki) drücken.

## Ablauf

1. Gast öffnet die Seite und gibt seine PIN ein.
2. Server prüft die PIN gegen `guests.json` (inkl. Gültigkeitszeitraum). Bei Erfolg
   entsteht eine Session, die 2 Stunden gültig ist.
3. Gast wird angewiesen, einmal zu klingeln. Der Server hört per Home-Assistant-
   WebSocket in Echtzeit auf den konfigurierten Klingel-Sensor.
4. Klingelt jemand, während eine gültige Session aktiv ist ("await_bell"), ruft der
   Server automatisch `lock.unlock` (bzw. den konfigurierten Service) für den Ring
   Intercom auf. Klingelt jemand ohne aktive Session (z. B. Postbote), passiert nichts.
5. Sobald die Haustür offen ist, sieht der Gast einen "Weiter"-Button und danach den
   Button "Wohnungstür öffnen", der `lock.unlock`/`lock.open` für den Nuki auslöst.

## Voraussetzungen in Home Assistant

- Offizielle **Ring**-Integration mit eingebundenem Ring Intercom (erscheint als
  `lock.*`-Entity) sowie einem Klingel-/"Ding"-Sensor (`binary_sensor.*`).
- Offizielle **Nuki**-Integration mit dem Smart Lock als `lock.*`-Entity.
- Ein **Long-Lived Access Token**: In Home Assistant unten links auf deinen
  Benutzernamen klicken → ganz nach unten scrollen → "Langlebige Zugriffstoken" →
  "Token erstellen".

### Entity-IDs finden

In Home Assistant unter **Entwicklerwerkzeuge → Zustände**:

- Klingel-Sensor: nach "ding" oder dem Gerätenamen filtern. Der Zustand muss beim
  Klingeln kurz auf `on` wechseln.
- Ring Intercom: Domain `lock`, z. B. `lock.haustuer_ring_intercom`.
- Nuki: Domain `lock`, z. B. `lock.wohnungstuer_nuki`.

Falls unsicher, in **Entwicklerwerkzeuge → Ereignisse** auf `state_changed` abonnieren
und einmal testweise klingeln – die Entity-ID erscheint im Log.

Die App erkennt selbst, ob sie als eigenständiger Docker-Container (`.env` +
`guests.json`) oder als Home Assistant Add-on (Konfiguration über die HA-Oberfläche,
kein Token nötig) läuft. Beide Wege sind unten beschrieben.

## Option A: Eigenständig per Docker Compose

1. `.env.example` nach `.env` kopieren und ausfüllen (HA-URL, Token, Entity-IDs).
2. Gäste in `guests.json` eintragen (PIN + Check-in/Check-out), z. B.:

   ```json
   [
     { "label": "Familie Müller", "pin": "4821", "checkIn": "2026-07-10T15:00:00", "checkOut": "2026-07-14T11:00:00" }
   ]
   ```

   Alternativ per CLI (auch im laufenden Container nutzbar):

   ```
   npm run add-guest
   # bzw. im Container: docker compose exec guest-door-app npm run add-guest
   ```

   `guests.json` wird bei jeder PIN-Eingabe frisch eingelesen – kein Neustart nötig.

3. Starten:

   ```
   docker compose up -d --build
   ```

   Ohne Docker: `npm install && npm start`.

4. App unter `http://<server-ip>:3000` aufrufen.

## Option B: Als Home Assistant Add-on (Supervised / HA OS)

Voraussetzung: Home Assistant OS oder Supervised (Container/Core ohne Supervisor kann
keine Add-ons ausführen – dann Option A nutzen).

**Empfohlen: über ein GitHub-Add-on-Repository.** Dieser Ordner ist bereits Teil eines
solchen Repos (siehe `../README.md` im übergeordneten Ordner) – dort steht die
Anleitung zum Pushen nach GitHub und Einbinden über **Einstellungen → Add-ons →
Add-on Store → ⋮ → Repositories**. Danach direkt mit Schritt 3 unten weitermachen.

**Alternativ: lokale Kopie ohne GitHub.**

1. Den kompletten Ordner `guest-door-app` (inkl. `config.yaml` und `Dockerfile`) auf den
   Home-Assistant-Host nach `/addons/local/guest-door-app` kopieren, z. B. über das
   **Samba**- oder **SSH & Terminal**-Add-on. `.env` und `guests.json` werden im
   Add-on-Modus nicht verwendet und können gelöscht werden.
2. In Home Assistant: **Einstellungen → Add-ons → Add-on Store** → oben rechts "⋮" →
   **"Repositories prüfen"** (bzw. Seite neu laden), damit der neue Ordner unter
   "Lokale Add-ons" erscheint.
3. Add-on **"Guest Door App"** öffnen → **Installieren**.
4. Im Tab **Konfiguration** eintragen: `doorbell_entity_id`, `ring_intercom_entity_id`,
   `ring_intercom_service`, `nuki_entity_id`, `nuki_service` sowie die Gästeliste
   (`guests`: Label, PIN, Check-in, Check-out) – alles direkt über die HA-Oberfläche,
   kein manuelles Token nötig (der Supervisor stellt automatisch Zugriff auf die
   Core-API bereit, siehe `homeassistant_api: true` in `config.yaml`).
5. Add-on **starten**. Web-UI ist unter `http://<home-assistant-ip>:3000` erreichbar.
6. Nach Änderungen an der Gästeliste/Entity-IDs im Konfigurations-Tab muss das Add-on
   **neu gestartet** werden, damit die neuen Werte geladen werden.

Für externen Zugriff (Gäste von unterwegs) weiterhin einen Reverse Proxy mit HTTPS
davorschalten – siehe Sicherheitshinweise.

## Sicherheitshinweise

- **HTTPS**: Wenn die App von außerhalb des lokalen Netzes erreichbar sein soll
  (z. B. für anreisende Gäste), unbedingt einen Reverse Proxy mit HTTPS davorschalten
  (z. B. Caddy, Traefik, nginx + Let's Encrypt), da sonst die PIN im Klartext übertragen wird.
- PIN-Eingaben werden pro IP-Adresse begrenzt (max. 8 Versuche / 15 Minuten).
- Sessions laufen nach 2 Stunden automatisch ab.
- Der HA-Token liegt nur serverseitig (`.env` bzw. vom Supervisor injiziert) und wird
  nie an den Browser gesendet.
- Die Haustür öffnet sich ausschließlich, wenn zuvor eine gültige PIN eingegeben wurde
  **und** danach geklingelt wird – ein Klingeln allein öffnet nichts.

## Anpassungen

- `RING_INTERCOM_SERVICE` / `NUKI_SERVICE` in `.env`: falls dein Türsystem statt
  `unlock` den Service `open` (Nuki: entriegeln + Türöffner) unterstützt und du das
  bevorzugst, hier eintragen.
- Session-Dauer: `SESSION_TTL_MS` in `server/sessions.js`.
- Rate-Limit: `MAX_ATTEMPTS` / `WINDOW_MS` in `server/rateLimiter.js`.
