const fs = require('fs');
const path = require('path');

// Erkennt automatisch, ob die App als Home Assistant Add-on läuft (Supervisor legt dann
// /data/options.json an, gefüllt mit den Werten aus dem Konfigurations-Tab des Add-ons)
// oder eigenständig per Docker Compose / "npm start" (Konfiguration über .env).
// Überschreibbar per Env-Var (nützlich für Tests); im Add-on immer /data/options.json.
const ADDON_OPTIONS_FILE = process.env.ADDON_OPTIONS_FILE || '/data/options.json';
const isAddon = fs.existsSync(ADDON_OPTIONS_FILE);

// Der Supervisor bindet den echten Home-Assistant-Konfigurationsordner (map:
// "homeassistant_config") historisch/dokumentationsabhängig entweder unter /homeassistant
// oder /config in den Container ein. Statt das fest zu verdrahten, wird zur Laufzeit
// geprüft, wo der von uns erwartete Unterordner tatsächlich liegt - vermeidet stille
// Fehlkonfiguration, falls sich das je nach Supervisor-Version unterscheidet.
function resolveImagesDir() {
  if (process.env.IMAGES_DIR_OVERRIDE) return process.env.IMAGES_DIR_OVERRIDE;
  const candidates = ['/homeassistant/guest-door-app-images', '/config/guest-door-app-images'];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    console.log(`[config] Bilder-Ordner gefunden: ${found}`);
    return found;
  }
  console.warn(
    `[config] Keiner der erwarteten Bilder-Ordner existiert (geprüft: ${candidates.join(', ')}). ` +
      'Fotos werden ausgeblendet, bis der Ordner angelegt ist.'
  );
  return candidates[0];
}

let config;

if (isAddon) {
  const opts = JSON.parse(fs.readFileSync(ADDON_OPTIONS_FILE, 'utf-8'));

  config = {
    mode: 'addon',
    // Der Supervisor stellt bei "homeassistant_api: true" in config.yaml automatisch
    // einen Proxy zur Core-API sowie SUPERVISOR_TOKEN bereit - kein eigenes Long-Lived
    // Token nötig.
    haUrl: 'http://supervisor/core',
    haToken: process.env.SUPERVISOR_TOKEN,
    doorbellEntityId: opts.doorbell_entity_id,
    ringIntercomEntityId: opts.ring_intercom_entity_id,
    ringIntercomService: opts.ring_intercom_service || 'unlock',
    nukiEntityId: opts.nuki_entity_id,
    nukiService: opts.nuki_service || 'unlock',
    // Optional: Lichter, die beim Öffnen der Wohnungstür automatisch angehen.
    hallwayLightEntityId: opts.hallway_light_entity_id || null,
    guestroomLightEntityId: opts.guestroom_light_entity_id || null,
    // Freitexte für die Gast-Anleitung (Klingelschild-Name, Stockwerk, Zimmer) -
    // kommen nur aus der Add-on-Konfiguration, landen nie im Quellcode/Git.
    bellLabel: opts.bell_label || '',
    apartmentLocation: opts.apartment_location || '',
    roomLocation: opts.room_location || '',
    // Fotos liegen in einem Unterordner des HA-Konfigurationsordners (nicht Teil des
    // Add-ons/Git), damit sie über den vorhandenen "File editor"-Add-on hochgeladen
    // werden können. Lege sie dort unter door.jpg bzw. room.jpg ab.
    imagesDir: resolveImagesDir(),
    // Passwort für die /admin-Seite (Gäste-Verwaltung mit Datum/Zeit-Picker).
    adminPassword: opts.admin_password || null,
    // Voller Name des notify-Service für Push-Benachrichtigungen an den Gastgeber,
    // z.B. "mobile_app_iphone17_von_max" (Teil nach "notify."). Leer = keine Benachrichtigungen.
    notifyService: opts.notify_service || '',
    // Gäste liegen in einer persistenten JSON-Datei, verwaltet über die /admin-Seite -
    // nicht mehr über die Add-on-Optionen (die bieten keinen Datum/Zeit-Picker).
    guests: null,
    guestsFile: process.env.GUESTS_FILE_OVERRIDE || '/data/guests.json',
    port: 3000,
  };
} else {
  require('dotenv').config();

  config = {
    mode: 'standalone',
    haUrl: process.env.HA_URL,
    haToken: process.env.HA_TOKEN,
    doorbellEntityId: process.env.DOORBELL_ENTITY_ID,
    ringIntercomEntityId: process.env.RING_INTERCOM_ENTITY_ID,
    ringIntercomService: process.env.RING_INTERCOM_SERVICE || 'unlock',
    nukiEntityId: process.env.NUKI_ENTITY_ID,
    nukiService: process.env.NUKI_SERVICE || 'unlock',
    hallwayLightEntityId: process.env.HALLWAY_LIGHT_ENTITY_ID || null,
    guestroomLightEntityId: process.env.GUESTROOM_LIGHT_ENTITY_ID || null,
    bellLabel: process.env.BELL_LABEL || '',
    apartmentLocation: process.env.APARTMENT_LOCATION || '',
    roomLocation: process.env.ROOM_LOCATION || '',
    // Lokaler Ordner außerhalb von public/ - per .gitignore ausgeschlossen, landet nie im Repo.
    imagesDir: path.join(__dirname, '..', 'images'),
    adminPassword: process.env.ADMIN_PASSWORD || null,
    notifyService: process.env.NOTIFY_SERVICE || '',
    guests: null,
    guestsFile: path.join(__dirname, '..', 'guests.json'),
    port: process.env.PORT || 3000,
  };
}

const REQUIRED = ['haUrl', 'haToken', 'doorbellEntityId', 'ringIntercomEntityId', 'nukiEntityId', 'adminPassword'];
for (const key of REQUIRED) {
  if (!config[key]) {
    console.error(
      `[config] Fehlende Konfiguration: ${key} (${config.mode === 'addon' ? 'Add-on-Optionen prüfen' : '.env prüfen'})`
    );
    process.exit(1);
  }
}

module.exports = config;
