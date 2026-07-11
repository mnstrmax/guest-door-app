const WebSocket = require('ws');

/**
 * Kapselt die Verbindung zu Home Assistant:
 * - WebSocket-Abo auf "state_changed", um das Klingel-Ereignis (Ring) in Echtzeit zu erkennen
 * - REST-Aufrufe, um lock.unlock / lock.open Services (Ring Intercom, Nuki) auszulösen
 */
class HAClient {
  constructor({ baseUrl, token, doorbellEntityId, onDoorbellRing }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.doorbellEntityId = doorbellEntityId;
    this.onDoorbellRing = onDoorbellRing;
    this.msgId = 1;
    this.ws = null;
    this.connected = false;
    this.reconnectDelay = 2000;
  }

  get wsUrl() {
    return this.baseUrl.replace(/^http/, 'ws') + '/api/websocket';
  }

  connect() {
    console.log(`[HA] Verbinde zu ${this.wsUrl} ...`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => console.log('[HA] WebSocket-Verbindung geöffnet'));

    this.ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'auth_required') {
        this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
      } else if (msg.type === 'auth_ok') {
        this.connected = true;
        console.log('[HA] Authentifiziert. Abonniere state_changed Events ...');
        this.ws.send(
          JSON.stringify({ id: this.msgId++, type: 'subscribe_events', event_type: 'state_changed' })
        );
      } else if (msg.type === 'auth_invalid') {
        console.error('[HA] Authentifizierung fehlgeschlagen - HA_TOKEN in .env prüfen.');
      } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
        const data = msg.event.data;
        if (data.entity_id === this.doorbellEntityId) {
          const newState = data.new_state?.state;
          const oldState = data.old_state?.state;
          // Nur triggern, wenn der Sensor von "nicht on" auf "on" wechselt
          // (verhindert Mehrfachauslösung, falls der Zustand kurz "on" bleibt).
          if (newState === 'on' && oldState !== 'on') {
            console.log(`[HA] Klingeln erkannt auf ${this.doorbellEntityId}`);
            this.onDoorbellRing?.();
          }
        }
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.warn(`[HA] WebSocket geschlossen. Erneuter Verbindungsversuch in ${this.reconnectDelay}ms ...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
    });

    this.ws.on('error', (err) => {
      console.error('[HA] WebSocket-Fehler:', err.message);
    });
  }

  async callService(domain, service, body) {
    const res = await fetch(`${this.baseUrl}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HA Service-Aufruf fehlgeschlagen (${res.status}): ${text}`);
    }
    return res.json();
  }

  async unlockRingIntercom(entityId, service = 'unlock') {
    return this.callService('lock', service, { entity_id: entityId });
  }

  async unlockNuki(entityId, service = 'unlock') {
    return this.callService('lock', service, { entity_id: entityId });
  }

  async turnOnLights(entityIds) {
    if (!entityIds || entityIds.length === 0) return;
    return this.callService('light', 'turn_on', { entity_id: entityIds });
  }

  /**
   * Schickt eine Push-Benachrichtigung an den Gastgeber, z.B. über die HA-Companion-App
   * (notifyService ist der Teil nach "notify.", z.B. "mobile_app_iphone17_von_max").
   * Best-effort: wenn nicht konfiguriert oder der Aufruf fehlschlägt, wird nichts geworfen -
   * eine fehlende Benachrichtigung soll niemals den eigentlichen Türvorgang blockieren.
   */
  async notify(notifyService, message, title) {
    if (!notifyService) return;
    try {
      await this.callService('notify', notifyService, { message, title });
    } catch (err) {
      console.error('[HA] Benachrichtigung konnte nicht gesendet werden:', err.message);
    }
  }
}

module.exports = HAClient;
