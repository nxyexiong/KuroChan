/**
 * remote-auth.js — device pairing against kurochan-server + device-token storage.
 *
 * Pairing is a device-code flow started on the PC:
 *   POST /api/pair/start  → { pairingId, pollSecret, userCode, verificationUri, expiresIn, interval }
 *   (user enters userCode on the website's /bind page)
 *   POST /api/pair/poll   → { status:"pending" } | { status:"complete", deviceId, deviceToken, username }
 *
 * The device token is encrypted at rest with Electron safeStorage (DPAPI on Windows).
 */
const fs   = require('fs');
const path = require('path');

class RemoteApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code || null;
  }
}

async function request(serverUrl, method, apiPath, { body, token, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(serverUrl + apiPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new RemoteApiError(res.status, data && data.error, data && data.message);
  return data;
}

function startPairing(serverUrl, { deviceName, appVersion }, opts) {
  return request(serverUrl, 'POST', '/api/pair/start', { ...opts, body: { deviceName, appVersion } });
}

function pollPairing(serverUrl, { pairingId, pollSecret }, opts) {
  return request(serverUrl, 'POST', '/api/pair/poll', { ...opts, body: { pairingId, pollSecret } });
}

function unbindSelf(serverUrl, token, opts) {
  return request(serverUrl, 'DELETE', '/api/device/self', { ...opts, token });
}

/**
 * Encrypted device-token file.
 * @param {{ safeStorage: import('electron').SafeStorage, filePath: string }} opts
 */
function createTokenStore({ safeStorage, filePath }) {
  return {
    get() {
      try {
        const buf = fs.readFileSync(filePath);
        return safeStorage.decryptString(buf) || null;
      } catch {
        return null;
      }
    },
    set(token) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system.');
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, safeStorage.encryptString(token));
    },
    clear() {
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    },
  };
}

module.exports = { RemoteApiError, startPairing, pollPairing, unbindSelf, createTokenStore };
