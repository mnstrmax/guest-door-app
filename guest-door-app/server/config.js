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

// Stockwerk/Zimmer-Nummer und Seite (links/rechts/mittig) werden strukturiert statt als
// Freitext konfiguriert. So kann jede Sprache im Frontend eine korrekt übersetzte,
// grammatikalisch passende Anleitung daraus bauen (z.B. "3rd floor, on the right" /
// "au 3e étage, à droite"), statt einen unübersetzten deutschen String anzuzeigen.
function normalizeInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const SIDE_MAP = {
  left: 'left',
  links: 'left',
  l: 'left',
  right: 'right',
  rechts: 'right',
  r: 'right',
  middle: 'middle',
  mitte: 'middle',
  mittig: 'middle',
  m: 'middle',
};
function normalizeSide(v) {
  if (!v) return null;
  return SIDE_MAP[String(v).trim().toLowerCase()] || null;
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
    // Klingelschild-Name (Eigenname, bleibt unübersetzt) kommt nur aus der
    // Add-on-Konfiguration, landet nie im Quellcode/Git.
    bellLabel: opts.bell_label || '',
    // Stockwerk/Zimmer strukturiert statt Freitext, damit das Frontend daraus in jeder
    // Sprache eine korrekt übersetzte Anleitung bauen kann (siehe normalizeInt/normalizeSide).
    apartmentFloor: normalizeInt(opts.apartment_floor),
    apartmentSide: normalizeSide(opts.apartment_side),
    roomNumber: normalizeInt(opts.room_number),
    roomSide: normalizeSide(opts.room_side),
    // Fotos liegen in einem Unterordner des HA-Konfigurationsordners (nicht Teil des
    // Add-ons/Git), damit sie über den vorhandenen "File editor"-Add-on hochgeladen
    // werden können. Lege sie dort unter door.jpg bzw. room.jpg ab.
    imagesDir: resolveImagesDir(),
    // Login für die /admin-Seite (Gäste-Verwaltung mit Datum/Zeit-Picker). Benutzername
    // frei wählbar (Default "admin"), Passwort Pflicht. adminTotpSecret ist optional: ist
    // er gesetzt, verlangt der Login zusätzlich einen 6-stelligen Code aus einer
    // Authenticator-App (2FA). Wird im Admin-Bereich per Klick auf "Neuen Code generieren"
    // erzeugt und muss danach manuell hier eingetragen werden - landet wie jedes andere
    // Geheimnis nie im Quellcode/Git.
    adminUsername: opts.admin_username || 'admin',
    adminPassword: opts.admin_password || null,
    adminTotpSecret: opts.admin_totp_secret || null,
    // Voller Name des notify-Service für Push-Benachrichtigungen an den Gastgeber,
    // z.B. "mobile_app_iphone17_von_max" (Teil nach "notify."). Leer = keine Benachrichtigungen.
    notifyService: opts.notify_service || '',
    // Optionaler input_boolean-Helfer: wird auf "on" gesetzt, solange die App auf ein
    // Klingeln wartet, und wieder auf "off", sobald das erledigt ist. Damit können eigene
    // HA-Automationen (z.B. eine allgemeine Klingel-Benachrichtigung) erkennen, dass die
    // App das Klingeln bereits selbst verarbeitet, und in dem Moment stumm bleiben.
    appActiveEntityId: opts.app_active_entity_id || null,
    // Zimmersteuerung für Rückkehrgäste (Menü statt erneutem Klingel-Ablauf). Alle drei
    // optional - ist keine gesetzt, wird die Menü-Option "Zimmer steuern" gar nicht erst
    // angezeigt und Rückkehrgäste durchlaufen weiterhin normal den Klingel-Ablauf.
    guestroomClimateEntityId: opts.guestroom_climate_entity_id || null,
    guestroomCeilingLightEntityId: opts.guestroom_ceiling_light_entity_id || null,
    guestroomFloorLightEntityId: opts.guestroom_floor_light_entity_id || null,
    // Optional: privater Airbnb-iCal-Export-Link (Kalender -> Verfügbarkeit -> "Mit
    // anderer Website verbinden" -> Link kopieren). Ist er gesetzt, importiert die App
    // Reservierungen automatisch als Gäste (PIN = letzte 4 Ziffern der Telefonnummer aus
    // dem Feed - Airbnb liefert seit 2019 keinen Gastnamen mehr). Der Link ist geheim wie
    // ein Passwort und landet nie im Quellcode/Git, nur hier in der Konfiguration.
    airbnbIcalUrl: opts.airbnb_ical_url || null,
    defaultCheckinTime: opts.default_checkin_time || '15:00',
    defaultCheckoutTime: opts.default_checkout_time || '11:00',
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
    apartmentFloor: normalizeInt(process.env.APARTMENT_FLOOR),
    apartmentSide: normalizeSide(process.env.APARTMENT_SIDE),
    roomNumber: normalizeInt(process.env.ROOM_NUMBER),
    roomSide: normalizeSide(process.env.ROOM_SIDE),
    // Lokaler Ordner außerhalb von public/ - per .gitignore ausgeschlossen, landet nie im Repo.
    imagesDir: path.join(__dirname, '..', 'images'),
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || null,
    adminTotpSecret: process.env.ADMIN_TOTP_SECRET || null,
    notifyService: process.env.NOTIFY_SERVICE || '',
    appActiveEntityId: process.env.APP_ACTIVE_ENTITY_ID || null,
    guestroomClimateEntityId: process.env.GUESTROOM_CLIMATE_ENTITY_ID || null,
    guestroomCeilingLightEntityId: process.env.GUESTROOM_CEILING_LIGHT_ENTITY_ID || null,
    guestroomFloorLightEntityId: process.env.GUESTROOM_FLOOR_LIGHT_ENTITY_ID || null,
    airbnbIcalUrl: process.env.AIRBNB_ICAL_URL || null,
    defaultCheckinTime: process.env.DEFAULT_CHECKIN_TIME || '15:00',
    defaultCheckoutTime: process.env.DEFAULT_CHECKOUT_TIME || '11:00',
    guests: null,
    guestsFile: path.join(__dirname, '..', 'guests.json'),
    port: process.env.PORT || 3000,
  };
}

// Zimmersteuerung nur anbieten, wenn mindestens eine der drei Entities konfiguriert ist.
config.hasRoomControls = !!(
  config.guestroomClimateEntityId ||
  config.guestroomCeilingLightEntityId ||
  config.guestroomFloorLightEntityId
);

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
