const crypto = require('crypto');

// Minimal-Implementierung von HOTP (RFC 4226) und TOTP (RFC 6238) sowie Base32
// (RFC 4648) - bewusst ohne npm-Abhängigkeit, um dem bisherigen dependency-armen Stil
// dieses Projekts treu zu bleiben. Kompatibel mit Standard-Authenticator-Apps (Google
// Authenticator, Authy, 1Password, ...), die per Default SHA1/6 Stellen/30 Sekunden
// verwenden - exakt die hier fest eingestellten Parameter.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (const char of clean) {
    const val = ALPHABET.indexOf(char);
    if (val === -1) continue; // ungültige Zeichen ignorieren statt zu werfen
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  // Restbits (falls Länge kein Vielfaches von 5) mit Nullen auffüllen, wie in RFC 4648.
  const rest = bits.length % 5;
  if (rest > 0) {
    const lastChunk = bits.slice(bits.length - rest).padEnd(5, '0');
    out += ALPHABET[parseInt(lastChunk, 2)];
  }
  return out;
}

// HOTP nach RFC 4226: HMAC-SHA1 über den 8-Byte-Big-Endian-Zähler, "dynamic truncation".
function hotp(secretBuffer, counter, digits = 6) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

// TOTP nach RFC 6238: HOTP mit Zähler = verstrichene 30-Sekunden-Intervalle seit Epoch.
function generateTotp(secretBase32, { step = 30, digits = 6, forTime = Date.now() } = {}) {
  const counter = Math.floor(forTime / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

// Prüft einen eingegebenen Code gegen das aktuelle Zeitfenster +/- "window" Schritte
// (Toleranz für leichte Zeitabweichung zwischen Server und Handy). Zeitkonstanter
// Vergleich, damit die Prüfung selbst keine Timing-Seitenkanäle öffnet.
function verifyTotp(secretBase32, token, { step = 30, digits = 6, window = 1 } = {}) {
  if (!token || !/^\d+$/.test(String(token))) return false;
  const normalizedToken = String(token).padStart(digits, '0');
  if (normalizedToken.length !== digits) return false;
  const secretBuffer = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = hotp(secretBuffer, counter + offset, digits);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalizedToken))) {
      return true;
    }
  }
  return false;
}

function generateBase32Secret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

function buildOtpauthUri(secretBase32, { label = 'Guest Door App', issuer = 'Guest Door App' } = {}) {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  base32Decode,
  base32Encode,
  hotp,
  generateTotp,
  verifyTotp,
  generateBase32Secret,
  buildOtpauthUri,
};
