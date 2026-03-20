/**
 * model.js — Model controller. Runs in main process.
 *
 * Controls lip sync by sending model:set-parameter IPC events to the renderer.
 * The renderer's model.js applies these parameters to the Live2D coreModel.
 */

/** @type {import('electron').BrowserWindow | null} */
let _win = null;

function setWindow(win) { _win = win; }

function _send(channel, data) {
  if (_win && !_win.isDestroyed()) _win.webContents.send(channel, data);
}

/**
 * Set the mouth open value for lip sync.
 * @param {number} value  0 (closed) to 1 (fully open)
 */
function setMouthOpen(value) {
  const clamped = Math.max(0, Math.min(1, value));
  _send('model:set-parameter', { id: 'ParamMouthOpenY', value: clamped, weight: 1.0 });
}

module.exports = { setWindow, setMouthOpen };
