/**
 * backend.js — the single seam between the renderer and its host backend.
 *
 * The renderer is HOST-AGNOSTIC: it talks only to this module, never to
 * `window.*`, Electron, a WebSocket, or `file://` directly, and never branches
 * on "am I Electron or web". Both hosts inject the SAME contract as the global
 * `window.kuroBackend`:
 *   - Electron: src/main/preload.js       (contextBridge over IPC)
 *   - Web:      src/main/web/web-api.js    (WebSocket shim)
 *
 * The contract's authoritative method list lives in src/main/preload.js.
 * Differences between hosts (model asset URLs, cursor source, save→reload,
 * window controls) are hidden behind the contract — see capabilities below for
 * the one thing the renderer feature-detects rather than assumes.
 */

const backend = (typeof window !== 'undefined') ? window.kuroBackend : undefined;

if (!backend) {
  throw new Error(
    'kuroBackend bridge not found. It is injected by preload.js (Electron) or ' +
    'web-api.js (web) before the renderer bundle runs. The renderer cannot run without it.',
  );
}

/**
 * Host capabilities for feature detection (NOT host detection). The renderer
 * reacts to which features exist, so the same code runs everywhere.
 *   - windowControls: the host owns a movable/closable app window (Electron).
 *     Web browsers provide their own window chrome, so this is false there.
 *   - settings: 'full' (every section) or 'binding-only' (remote browsers via
 *     kurochan-server, which may not change any settings except the binding).
 *   - binding: 'device' (bind/unbind this PC) or 'account' (remote browser:
 *     shows the signed-in account and can unbind the PC through the website).
 */
export const capabilities = Object.assign(
  { windowControls: false, settings: 'full', binding: 'device' },
  backend.capabilities || {},
);

export default backend;
