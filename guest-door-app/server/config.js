const fs = require('fs');
const path = require('path');

// Erkennt automatisch, ob die App als Home Assistant Add-on läuft (Supervisor legt dann
// /data/options.json an, gefüllt mit den Werten aus dem Konfigurations-Tab des Add-ons)
// oder eigenständig per Docker Compose / "npm start" (Konfiguration über .env + guests.json).
// Überschreibbar per Env-Var (nützlich für Tests); im Add-on immer /data/options.json.
const ADDON_OPTIONS_FILE = process.env.ADDON_OPTIONS_FILE || '/data/options.json';
const isAddon = fs.existsSync(ADDON_OPTIONS_FILE);

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
    // Gästeliste kommt direkt aus den Add-on-Optionen (HA-Konfigurationsseite), nicht aus einer Datei.
    guests: (opts.guests || []).map((g) => ({
      label: g.label,
      pin: g.pin,
      checkIn: g.check_in,
      checkOut: g.check_out,
    })),
    guestsFile: null,
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
    guests: null,
    guestsFile: path.join(__dirname, '..', 'guests.json'),
    port: process.env.PORT || 3000,
  };
}

const REQUIRED = ['haUrl', 'haToken', 'doorbellEntityId', 'ringIntercomEntityId', 'nukiEntityId'];
for (const key of REQUIRED) {
  if (!config[key]) {
    console.error(
      `[config] Fehlende Konfiguration: ${key} (${config.mode === 'addon' ? 'Add-on-Optionen prüfen' : '.env prüfen'})`
    );
    process.exit(1);
  }
}

module.exports = config;
