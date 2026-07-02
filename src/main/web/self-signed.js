/**
 * self-signed.js — cached self-signed TLS cert for web mode.
 *
 * Browsers gate microphone capture (getUserMedia) behind a "secure context":
 * automatic on localhost, but blocked on a plain-http LAN address — so phone
 * voice input needs HTTPS. We generate a self-signed cert once and cache it in
 * ~/.kurochan/web-cert/ so it stays stable across launches (accept the browser
 * warning once). SANs include localhost + this machine's current LAN IPv4s.
 */
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const CERT_DIR  = path.join(os.homedir(), '.kurochan', 'web-cert');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH  = path.join(CERT_DIR, 'key.pem');

/** All non-internal IPv4 addresses of this machine. */
function localIPv4s() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function generate(ips) {
  const selfsigned = require('selfsigned');
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  for (const ip of ips) altNames.push({ type: 7, ip });
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'kurochan.local' }],
    { days: 3650, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] },
  );
  return { cert: pems.cert, key: pems.private };
}

/**
 * Return { cert, key } PEM strings. Uses a user-provided pair when given,
 * otherwise a cached self-signed cert (regenerated only if missing).
 */
function getCert({ certPath, keyPath } = {}) {
  if (certPath && keyPath) {
    return { cert: fs.readFileSync(certPath, 'utf8'), key: fs.readFileSync(keyPath, 'utf8') };
  }
  try {
    if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
      return { cert: fs.readFileSync(CERT_PATH, 'utf8'), key: fs.readFileSync(KEY_PATH, 'utf8') };
    }
  } catch { /* fall through and regenerate */ }
  const pair = generate(localIPv4s());
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(CERT_PATH, pair.cert);
    fs.writeFileSync(KEY_PATH, pair.key);
  } catch { /* non-fatal — use in-memory cert */ }
  return pair;
}

module.exports = { getCert, localIPv4s };
