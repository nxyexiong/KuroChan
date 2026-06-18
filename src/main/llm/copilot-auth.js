/**
 * copilot-auth.js — GitHub Copilot auth + SDK helpers (main process).
 *
 * The @github/copilot-sdk does NOT expose a device-flow login over JSON-RPC, so
 * we implement GitHub's OAuth Device Flow ourselves and hand the resulting
 * access token to the SDK via the `gitHubToken` client option.
 *
 * Also provides path resolution (CLI home + workspace under ~/.kurochan), a
 * client factory, and a model-listing helper used by the Settings UI.
 */
const { CopilotClient } = require('@github/copilot-sdk');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const DEVICE_CODE_URL  = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

// Public GitHub Copilot OAuth app client id used for editor device-flow login.
// Tokens minted via this flow are accepted by the Copilot runtime
// (exchanged at /copilot_internal/v2/token). Same id used by copilot.vim et al.
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const SCOPE     = 'read:user';

const KURO_DIR = path.join(os.homedir(), '.kurochan');

// Preload injected into the spawned CLI (Electron-only) to fix commander argv
// parsing under ELECTRON_RUN_AS_NODE. `.replace('app.asar', ...)` resolves the
// unpacked copy when packaged (no-op in dev). Forward slashes so the path
// survives NODE_OPTIONS parsing on Windows.
const CLI_SHIM_PATH = path
  .join(__dirname, 'copilot-cli-shim.cjs')
  .replace('app.asar', 'app.asar.unpacked')
  .replace(/\\/g, '/');

/**
 * Resolve (and create) the Copilot CLI home dir and agent working directory,
 * both kept inside ~/.kurochan as required.
 */
function getCopilotPaths() {
  const baseDirectory   = path.join(KURO_DIR, '.copilot');   // -> COPILOT_HOME
  const workingDirectory = path.join(KURO_DIR, 'workspace');  // -> agent cwd
  try { fs.mkdirSync(baseDirectory, { recursive: true }); } catch { /* non-fatal */ }
  try { fs.mkdirSync(workingDirectory, { recursive: true }); } catch { /* non-fatal */ }
  return { baseDirectory, workingDirectory };
}

/**
 * Create a CopilotClient bound to our token + ~/.kurochan paths.
 * @param {string} token GitHub access token (ignored when noGitHubAuth).
 * @param {{ noGitHubAuth?: boolean }} [opts] When noGitHubAuth, start the CLI
 *        with no GitHub identity at all (useLoggedInUser:false, no token). Used
 *        for BYOK sessions, which route inference to a custom provider and don't
 *        require a GitHub login.
 */
function createCopilotClient(token, { noGitHubAuth = false } = {}) {
  const { baseDirectory, workingDirectory } = getCopilotPaths();
  // The SDK spawns the bundled CLI via spawn(process.execPath, [cliPath]).
  // Inside Electron, process.execPath is electron.exe, so we run it as Node
  // (ELECTRON_RUN_AS_NODE) — otherwise the child launches as an Electron app
  // and exits immediately. Under ELECTRON_RUN_AS_NODE, Electron still reports
  // process.versions.electron while leaving process.defaultApp unset, which
  // breaks the CLI's commander argv parsing; the --require preload fixes that.
  const env = { ...process.env };
  if (process.versions && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
    const requireFlag = `--require "${CLI_SHIM_PATH}"`;
    env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${requireFlag}` : requireFlag;
  }
  return new CopilotClient({
    gitHubToken: (!noGitHubAuth && token) ? token : undefined,
    useLoggedInUser: noGitHubAuth ? false : (token ? false : true),
    baseDirectory,
    workingDirectory,
    env,
    logLevel: 'error',
  });
}

async function requestDeviceCode() {
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`Device code request failed (${res.status})`);
  const j = await res.json();
  if (!j.device_code) throw new Error(j.error_description || 'No device code returned by GitHub');
  return j; // { device_code, user_code, verification_uri, expires_in, interval }
}

async function pollForAccessToken(deviceCode, intervalSec, expiresInSec, shouldCancel) {
  let interval = (intervalSec || 5) * 1000;
  const deadline = Date.now() + (expiresInSec || 900) * 1000;
  while (Date.now() < deadline) {
    if (shouldCancel && shouldCancel()) throw new Error('Login cancelled');
    await new Promise(r => setTimeout(r, interval));
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (j.access_token) return j.access_token;
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { interval += 5000; continue; }
    if (j.error === 'expired_token') throw new Error('The code expired before you authorized. Please try again.');
    if (j.error === 'access_denied')  throw new Error('Authorization was denied.');
    if (j.error) throw new Error(j.error_description || j.error);
  }
  throw new Error('Login timed out. Please try again.');
}

/**
 * Run the full device-flow login.
 * @param {(code: { userCode: string, verificationUri: string }) => void} onCode
 *        Called once the user code is available, so the UI can display it.
 * @param {() => boolean} [shouldCancel] Optional cancellation predicate.
 * @returns {Promise<string>} the GitHub access token.
 */
async function loginWithDeviceFlow(onCode, shouldCancel) {
  const dc = await requestDeviceCode();
  if (onCode) onCode({ userCode: dc.user_code, verificationUri: dc.verification_uri });
  return pollForAccessToken(dc.device_code, dc.interval, dc.expires_in, shouldCancel);
}

/** Simplify a raw ModelInfo for the renderer. */
function simplifyModel(m) {
  return {
    id: m.id,
    name: m.name || m.id,
    supportsReasoningEffort: !!(m.capabilities && m.capabilities.supports && m.capabilities.supports.reasoningEffort),
    supportedReasoningEfforts: Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [],
    defaultReasoningEffort: m.defaultReasoningEffort || null,
    maxContextWindowTokens: (m.capabilities && m.capabilities.limits && m.capabilities.limits.max_context_window_tokens) || null,
  };
}

/** List available Copilot models (spawns a short-lived client). */
async function listCopilotModels(token) {
  const client = createCopilotClient(token);
  try {
    await client.start();
    const models = await client.listModels();
    return (models || []).map(simplifyModel);
  } finally {
    try { await client.stop(); } catch { /* ignore */ }
  }
}

/** Get auth status for a token (spawns a short-lived client). */
async function getAuthStatus(token) {
  const client = createCopilotClient(token);
  try {
    await client.start();
    return await client.getAuthStatus();
  } finally {
    try { await client.stop(); } catch { /* ignore */ }
  }
}

module.exports = {
  CLIENT_ID,
  getCopilotPaths,
  createCopilotClient,
  loginWithDeviceFlow,
  listCopilotModels,
  getAuthStatus,
};
