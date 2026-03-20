/**
 * openclaw-device-identity.js — Ed25519 device identity helpers (main process).
 *
 * Uses Node.js crypto directly since we're in the main process.
 */
const nodeCrypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const IDENTITY_PATH = path.join(os.homedir(), '.kurochan', 'device-identity.json');

function b64uEncode(buf) {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function b64uDecode(s) {
  const norm   = s.replaceAll('-', '+').replaceAll('_', '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

const PKCS8_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function generateDeviceIdentity() {
  const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const pubRaw   = publicKey.slice(12);
  const privSeed = privateKey.slice(16, 48);
  const hashBuf  = nodeCrypto.createHash('sha256').update(pubRaw).digest();
  const deviceId = hashBuf.toString('hex');
  return { deviceId, publicKey: b64uEncode(pubRaw), privateKey: b64uEncode(privSeed) };
}

function loadOrCreateDeviceIdentity() {
  try {
    const raw = fs.readFileSync(IDENTITY_PATH, 'utf8');
    const p = JSON.parse(raw);
    if (p?.version === 1 && p.deviceId && p.publicKey && p.privateKey) {
      return { deviceId: p.deviceId, publicKey: p.publicKey, privateKey: p.privateKey };
    }
  } catch { /* fall through */ }
  const identity = generateDeviceIdentity();
  try {
    fs.mkdirSync(path.dirname(IDENTITY_PATH), { recursive: true });
    fs.writeFileSync(IDENTITY_PATH, JSON.stringify(
      { version: 1, ...identity, createdAtMs: Date.now() },
    ), 'utf8');
  } catch { /* non-fatal */ }
  return identity;
}

function signDevicePayload(privateKeyBase64Url, payload) {
  const seed  = b64uDecode(privateKeyBase64Url);
  const pkcs8 = Buffer.concat([PKCS8_PREFIX, seed]);
  const privKey = nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const sig = nodeCrypto.sign(null, Buffer.from(payload, 'utf8'), privKey);
  return b64uEncode(sig);
}

function buildConnectPayload({ deviceId, clientId, mode, role, scopes, signedAtMs, token, nonce }) {
  return ['v2', deviceId, clientId, mode, role, scopes.join(','), String(signedAtMs), token ?? '', nonce].join('|');
}

module.exports = {
  generateDeviceIdentity,
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  buildConnectPayload,
  b64uEncode,
  b64uDecode,
};
