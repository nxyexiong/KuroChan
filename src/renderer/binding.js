/**
 * binding.js — "Binding" settings (renderer).
 *
 * Two variants, feature-detected via capabilities.binding:
 *   - 'device'  (desktop window / LAN web): bind this PC to a kurochan-server
 *               account (shows a code to enter on the website), or unbind it.
 *   - 'account' (remote browser): binding-only settings — shows who is signed
 *               in and which PC is bound, and lets the user unbind / log out.
 */

import backend from './backend.js';

// ── Device variant (part of the full Settings modal) ──────────────────────────

export const DEVICE_BINDING_HTML = `
    <details class="settings-section" id="binding-section" open>
      <summary class="settings-section-title">Binding</summary>
      <div class="settings-section-body">
      <div class="settings-hint binding-hint">Use KuroChan from anywhere at <span id="binding-server" class="server-url"></span></div>
      <label for="binding-device-name-input">Device name</label>
      <div class="input-row">
        <input type="text" id="binding-device-name-input" maxlength="64" />
      </div>
      <div class="input-row">
        <button class="btn-modal" id="binding-bind-btn" type="button">Bind</button>
        <button class="btn-modal hidden" id="binding-cancel-btn" type="button">Cancel</button>
        <button class="btn-modal hidden" id="binding-unbind-btn" type="button">Unbind</button>
        <span id="binding-status" class="settings-hint"></span>
      </div>
      <div id="binding-code-row" class="copilot-code-row hidden">
        <span id="binding-code" class="copilot-code"></span>
        <span id="binding-tip" class="settings-hint"></span>
      </div>
      </div>
    </details>
`;

const STATE_TEXT = {
  unbound:    'Not bound',
  pairing:    'Waiting for the code to be entered…',
  connecting: 'Connecting…',
  online:     '🟢 Online',
  offline:    '🟠 Offline — reconnecting…',
  error:      '⚠ Disconnected',
};

/**
 * Wire the device Binding section (already in the DOM).
 * @returns {{ refresh: () => Promise<void>, deviceName: () => string }}
 */
export function initDeviceBinding() {
  const serverEl   = document.getElementById('binding-server');
  const nameInput  = document.getElementById('binding-device-name-input');
  const bindBtn    = document.getElementById('binding-bind-btn');
  const cancelBtn  = document.getElementById('binding-cancel-btn');
  const unbindBtn  = document.getElementById('binding-unbind-btn');
  const statusEl   = document.getElementById('binding-status');
  const codeRow    = document.getElementById('binding-code-row');
  const codeEl     = document.getElementById('binding-code');
  const tipEl      = document.getElementById('binding-tip');
  let countdown = null;

  function render(s) {
    if (!s) return;
    serverEl.textContent = s.server || '';
    if (document.activeElement !== nameInput && !nameInput.dataset.dirty) nameInput.value = s.deviceName || '';

    const bound = !!s.username && s.state !== 'unbound';
    const pairing = s.state === 'pairing' && s.pairing;
    bindBtn.classList.toggle('hidden', bound || !!pairing);
    cancelBtn.classList.toggle('hidden', !pairing);
    unbindBtn.classList.toggle('hidden', !bound);
    nameInput.disabled = !!pairing;

    let text = STATE_TEXT[s.state] || s.state;
    if (bound) {
      text = `Bound to ${s.username} · ${STATE_TEXT[s.state] || s.state}`;
      if (s.state === 'online' && s.clients) text += ` · ${s.clients} browser${s.clients === 1 ? '' : 's'}`;
    }
    if (s.error) text += ` — ${s.error}`;
    statusEl.textContent = text;

    clearInterval(countdown);
    if (pairing) {
      codeEl.textContent = s.pairing.userCode;
      const tick = () => {
        const left = Math.max(0, Math.round((s.pairing.expiresAt - Date.now()) / 1000));
        const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
        tipEl.textContent = `Enter this code at ${s.pairing.verificationUri} (expires in ${mm}:${ss})`;
      };
      tick();
      countdown = setInterval(tick, 1000);
      codeRow.classList.remove('hidden');
    } else {
      codeRow.classList.add('hidden');
    }
  }

  async function refresh() {
    nameInput.dataset.dirty = '';
    try { render(await backend.remoteStatus()); }
    catch (err) { statusEl.textContent = `⚠ ${err.message}`; }
  }

  nameInput.addEventListener('input', () => { nameInput.dataset.dirty = '1'; });

  bindBtn.addEventListener('click', async () => {
    bindBtn.disabled = true;
    statusEl.textContent = 'Starting…';
    try {
      const res = await backend.remoteBind(nameInput.value.trim());
      if (!res || !res.ok) statusEl.textContent = `⚠ ${(res && res.error) || 'Failed to start binding'}`;
    } catch (err) {
      statusEl.textContent = `⚠ ${err.message}`;
    } finally {
      bindBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', () => { backend.remoteCancelBind().catch(() => {}); });

  unbindBtn.addEventListener('click', async () => {
    if (!confirm('Unbind this PC? Remote browsers will be disconnected.')) return;
    unbindBtn.disabled = true;
    try {
      const res = await backend.remoteUnbind();
      if (!res || !res.ok) statusEl.textContent = `⚠ ${(res && res.error) || 'Failed to unbind'}`;
    } catch (err) {
      statusEl.textContent = `⚠ ${err.message}`;
    } finally {
      unbindBtn.disabled = false;
    }
  });

  backend.onRemoteStatus(render);

  return { refresh, deviceName: () => nameInput.value.trim() };
}

// ── Account variant (remote browser: the whole Settings modal) ────────────────

const ACCOUNT_MODAL_HTML = `
<div id="settings-modal" class="modal-overlay hidden">
  <div class="modal">
    <h3>Settings</h3>
    <div class="modal-body">
    <details class="settings-section" open>
      <summary class="settings-section-title">Binding</summary>
      <div class="settings-section-body">
      <div class="binding-account-line">Signed in as <strong id="account-username">…</strong></div>
      <div class="binding-account-line">Device <strong id="account-device">…</strong> <span id="account-device-status" class="settings-hint"></span></div>
      <div class="settings-hint">Other settings can only be changed on the PC.</div>
      <div class="input-row binding-actions">
        <button class="btn-modal" id="account-unbind-btn" type="button">Unbind this device</button>
      </div>
      <div class="input-row binding-links">
        <a id="account-link" href="/account" target="_top">Account</a>
        <span class="settings-hint">·</span>
        <a id="account-logout" href="#">Log out</a>
      </div>
      <span id="account-error" class="settings-hint"></span>
      </div>
    </details>
    </div>
    <div class="modal-actions">
      <button class="btn-modal" id="btn-settings-cancel">Close</button>
    </div>
  </div>
</div>
`;

export function initAccountSettings() {
  document.body.insertAdjacentHTML('beforeend', ACCOUNT_MODAL_HTML);
  const modal     = document.getElementById('settings-modal');
  const userEl    = document.getElementById('account-username');
  const deviceEl  = document.getElementById('account-device');
  const statusEl  = document.getElementById('account-device-status');
  const errorEl   = document.getElementById('account-error');
  const unbindBtn = document.getElementById('account-unbind-btn');
  const linkEl    = document.getElementById('account-link');

  if (backend.accountUrl) linkEl.href = backend.accountUrl;

  document.getElementById('btn-settings').addEventListener('click', async () => {
    errorEl.textContent = '';
    modal.classList.remove('hidden');
    try {
      const info = await backend.accountInfo();
      userEl.textContent = info.username || '?';
      deviceEl.textContent = info.device ? `"${info.device.name}"` : '(none)';
      const parts = [];
      if (info.device) parts.push(info.device.online ? '🟢 Online' : '🟠 Offline');
      if (info.appVersion) parts.push(`app v${info.appVersion}`);
      statusEl.textContent = parts.join(' · ');
    } catch (err) {
      errorEl.textContent = `⚠ ${err.message}`;
    }
  });

  document.getElementById('btn-settings-cancel').addEventListener('click', () => modal.classList.add('hidden'));

  unbindBtn.addEventListener('click', async () => {
    if (!confirm('Unbind your PC from this account? You will need to bind it again from the PC.')) return;
    unbindBtn.disabled = true;
    try { await backend.unbindDevice(); }
    catch (err) { errorEl.textContent = `⚠ ${err.message}`; unbindBtn.disabled = false; }
  });

  document.getElementById('account-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    try { await backend.logout(); }
    catch (err) { errorEl.textContent = `⚠ ${err.message}`; }
  });
}
