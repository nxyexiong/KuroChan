/**
 * openclaw-device-identity.js
 *
 * Ed25519 device identity helpers for the OpenClaw gateway protocol.
 * Uses the Web Crypto API (crypto.subtle) so it works in both the Electron
 * renderer and in Node 18+ (where globalThis.crypto is the Web Crypto API).
 */

// PKCS#8 DER header for a bare 32-byte Ed25519 seed (RFC 8410):
//   SEQUENCE {
//     INTEGER 0                    -- version
//     SEQUENCE { OID 1.3.101.112 } -- Ed25519 AlgorithmIdentifier
//     OCTET STRING {
//       OCTET STRING <32 bytes>    -- seed
//     }
//   }
export const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export const DEVICE_IDENTITY_STORAGE_KEY = 'kurochan-device-identity-v1';

export function b64uEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function b64uDecode(s) {
  const norm   = s.replaceAll('-', '+').replaceAll('_', '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin    = atob(padded);
  const out    = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateDeviceIdentity() {
  // Delegate to the main process — Ed25519 Web Crypto is not available in the
  // Electron renderer (Chrome 120 / Electron 28).
  return window.electronAPI.deviceIdentityGenerate();
}

export async function loadOrCreateDeviceIdentity() {
  try {
    const raw = localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.version === 1 && p.deviceId && p.publicKey && p.privateKey) {
        return { deviceId: p.deviceId, publicKey: p.publicKey, privateKey: p.privateKey };
      }
    }
  } catch { /* fall through to regenerate */ }
  const identity = await generateDeviceIdentity();
  try {
    localStorage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(
      { version: 1, ...identity, createdAtMs: Date.now() },
    ));
  } catch { /* non-fatal if storage unavailable */ }
  return identity;
}

/**
 * Sign a v2 device-auth payload string with the given base64url Ed25519 seed.
 * Returns the base64url-encoded signature.
 */
export async function signDevicePayload(privateKeyBase64Url, payload) {
  // Delegate to the main process — Ed25519 Web Crypto is not available in the
  // Electron renderer (Chrome 120 / Electron 28).
  return window.electronAPI.deviceIdentitySign({ privateKeyB64u: privateKeyBase64Url, payload });
}

/**
 * Build the v2 device-auth payload string exactly as _sendConnect does.
 * The gateway's handshake-auth-helpers.ts verifies this payload.
 */
export function buildConnectPayload({ deviceId, clientId, mode, role, scopes, signedAtMs, token, nonce }) {
  return [
    'v2', deviceId, clientId, mode,
    role, scopes.join(','), String(signedAtMs), token ?? '', nonce,
  ].join('|');
}
