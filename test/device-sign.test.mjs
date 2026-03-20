/**
 * test-device-sign.mjs
 *
 * Tests the signing logic (buildConnectPayload from openclaw-device-identity.js +
 * the main-process IPC handler in main.js) against known-good values captured
 * from a live openclaw-control-ui session.
 *
 * signDevicePayload now delegates to window.electronAPI (main process IPC), so
 * we stub that here with the exact same Node crypto code used in main.js.
 *
 * Run with:  node test-device-sign.mjs
 */

import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';

// ── Stub window.electronAPI to mirror the main-process IPC handler ─────────────
const PKCS8_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function nodeB64uDecode(s) {
  const norm   = s.replaceAll('-', '+').replaceAll('_', '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

globalThis.window = {
  electronAPI: {
    deviceIdentitySign: async ({ privateKeyB64u, payload }) => {
      const seed    = nodeB64uDecode(privateKeyB64u);
      const pkcs8   = Buffer.concat([PKCS8_PREFIX, seed]);
      const privKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
      const sig     = nodeSign(null, Buffer.from(payload, 'utf8'), privKey);
      return sig.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    },
    deviceIdentityGenerate: async () => {
      const { generateKeyPairSync, createHash } = await import('node:crypto');
      const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding:  { type: 'spki',  format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
      });
      const pubRaw   = publicKey.slice(12);
      const privSeed = privateKey.slice(16, 48);
      const deviceId = createHash('sha256').update(pubRaw).digest('hex');
      const b64u = (buf) => buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      return { deviceId, publicKey: b64u(pubRaw), privateKey: b64u(privSeed) };
    },
  },
};

// btoa/atob needed by b64uEncode/b64uDecode in the module
if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
}

// ── Import the service helpers (after stubbing window) ────────────────────────
import {
  signDevicePayload,
  buildConnectPayload,
  b64uDecode,
} from '../src/main/llm/openclaw-device-identity.js';

// ── Server-side verifier (mirrors gateway's verifyDeviceSignature) ─────────────

const SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

function serverVerify(publicKeyB64u, payload, signatureB64u) {
  try {
    const pubRaw = Buffer.from(b64uDecode(publicKeyB64u));
    const pubKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pubRaw]), format: 'der', type: 'spki' });
    const sig    = Buffer.from(b64uDecode(signatureB64u));
    return nodeVerify(null, Buffer.from(payload, 'utf8'), pubKey, sig);
  } catch {
    return false;
  }
}

// ── Known-good values from the captured live session ─────────────────────────
const PRIVATE_KEY  = '9g1LlaBRs2xQXMzhCN7JdSp6v2VsNckp5rE-tl6rVGM';
const PUBLIC_KEY   = 'EEqyGEK5A2WjuFWpWIFaHklq0SnMD3fVBSPfUxFR2Jk';
const KNOWN_SIG    = 'ajEIguLcgW1cEmN0k4QBi2Cu4E2eK2pusSqAYGSU0MVBhVXWufX4W8rZuxLEMJQlKUge9vmcMHO-e4SJ0BtNBg';
const DEVICE_ID    = '110f4d09b08636bdb5400f8fc0eca3cba2df4ef2dacd28f72cd2ad7faf9df720';
const NONCE        = 'a6c69878-53de-491e-ab19-25455408f34b';
const SIGNED_AT    = 1773846580214;
const TOKEN        = 'd0306a23714534d40b290f3e6293798331eb50aae17111d2';
const SCOPES       = ['operator.admin', 'operator.approvals', 'operator.pairing'];

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function testExact(label, fn) {
  try {
    const { payload, signature } = await fn();
    const matchesKnown   = signature === KNOWN_SIG;
    const serverVerified = serverVerify(PUBLIC_KEY, payload, signature);
    const ok = matchesKnown && serverVerified;
    if (ok) passed++; else failed++;
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    if (!ok) {
      console.log('   payload        :', payload);
      console.log('   produced sig   :', signature);
      console.log('   matches known  :', matchesKnown);
      console.log('   server-verified:', serverVerified);
    }
  } catch (err) {
    failed++;
    console.log(`❌ ${label} — THREW: ${err.message}`);
  }
}

async function testServerOnly(label, fn) {
  try {
    const { payload, signature } = await fn();
    const serverVerified = serverVerify(PUBLIC_KEY, payload, signature);
    if (serverVerified) passed++; else failed++;
    console.log(`${serverVerified ? '✅' : '❌'} ${label}`);
    if (!serverVerified) {
      console.log('   payload  :', payload);
      console.log('   signature:', signature);
    }
  } catch (err) {
    failed++;
    console.log(`❌ ${label} — THREW: ${err.message}`);
  }
}

async function testRejects(label, fn) {
  try {
    const { payload, signature } = await fn();
    const rejected = !serverVerify(PUBLIC_KEY, payload, signature);
    if (rejected) passed++; else failed++;
    console.log(`${rejected ? '✅' : '❌'} ${label}`);
    if (!rejected) console.log('   BUG: tampered payload was accepted by server verifier');
  } catch (err) {
    failed++;
    console.log(`❌ ${label} — THREW: ${err.message}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1. Exact match against the known-good captured session (with token).
//    This is the primary test — confirms the service produces the right signature.
await testExact('Full match: buildConnectPayload + signDevicePayload vs captured session', async () => {
  const payload   = buildConnectPayload({ deviceId: DEVICE_ID, clientId: 'openclaw-control-ui', mode: 'webchat', role: 'operator', scopes: SCOPES, signedAtMs: SIGNED_AT, token: TOKEN, nonce: NONCE });
  const signature = await signDevicePayload(PRIVATE_KEY, payload);
  return { payload, signature };
});

// 2. No-token case: different payload but crypto must still be sound.
await testServerOnly('No-token: produces valid signature (server-verified)', async () => {
  const payload   = buildConnectPayload({ deviceId: DEVICE_ID, clientId: 'openclaw-control-ui', mode: 'webchat', role: 'operator', scopes: SCOPES, signedAtMs: SIGNED_AT, token: '', nonce: NONCE });
  const signature = await signDevicePayload(PRIVATE_KEY, payload);
  return { payload, signature };
});

// 3. Tampered payload must be rejected.
await testRejects('Tampered payload rejected by server verifier', async () => {
  const payload  = buildConnectPayload({ deviceId: DEVICE_ID, clientId: 'openclaw-control-ui', mode: 'webchat', role: 'operator', scopes: SCOPES, signedAtMs: SIGNED_AT, token: TOKEN, nonce: NONCE }) + 'TAMPERED';
  return { payload, signature: KNOWN_SIG };
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
