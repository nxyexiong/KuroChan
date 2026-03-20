/**
 * builtin-model-service.js — Built-in model service implementation.
 *
 * Controls lip sync by sending Live2D model parameters to the local
 * renderer via BrowserWindow IPC.
 */
const { ModelService } = require('./model-service.js');

class BuiltinModelService extends ModelService {
  constructor() {
    super();
    /** @type {import('electron').BrowserWindow | null} */
    this._win = null;
  }

  setBuiltinWindow(win) {
    this._win = win;
  }

  _send(channel, data) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(channel, data);
    }
  }

  setMouthOpen(value) {
    const clamped = Math.max(0, Math.min(1, value));
    this._send('model:set-parameter', { id: 'ParamMouthOpenY', value: clamped, weight: 1.0 });
  }
}

module.exports = { BuiltinModelService };
