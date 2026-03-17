/**
 * ui.js — status bar and toolbar button helpers
 */

const statusEl = document.getElementById('status');

export function setStatus(text) {
  statusEl.style.display = '';
  statusEl.textContent = text;
}

export function hideStatusAfter(ms = 3000) {
  setTimeout(() => { statusEl.style.display = 'none'; }, ms);
}
