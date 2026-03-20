/**
 * status.js — status bar helpers (renderer)
 */

const statusEl = document.getElementById('status');
let _hideTimer = null;

export function setStatus(text, duration = 5000) {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
  statusEl.style.display = '';
  statusEl.textContent = text;
  if (duration > 0) {
    _hideTimer = setTimeout(() => { statusEl.style.display = 'none'; _hideTimer = null; }, duration);
  }
}
