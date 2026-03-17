/**
 * settings.js — injects the settings modal into the DOM and handles its logic
 */

const MODAL_HTML = `
<div id="settings-modal" class="modal-overlay hidden">
  <div class="modal">
    <h3>Settings</h3>
    <label for="model-dir-input">Model folder</label>
    <div class="input-row">
      <input type="text" id="model-dir-input" placeholder="e.g. assets/models/Haru" />
      <button class="btn-modal" id="btn-browse">Browse…</button>
    </div>
    <div class="modal-actions">
      <button class="btn-modal" id="btn-settings-cancel">Cancel</button>
      <button class="btn-modal primary" id="btn-settings-save">Save &amp; Reload</button>
    </div>
  </div>
</div>
`;

export function initSettings() {
  // Inject modal markup
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);

  const modal         = document.getElementById('settings-modal');
  const modelDirInput = document.getElementById('model-dir-input');
  const browseBtn     = document.getElementById('btn-browse');
  const saveBtn       = document.getElementById('btn-settings-save');
  const cancelBtn     = document.getElementById('btn-settings-cancel');

  document.getElementById('btn-settings').addEventListener('click', async () => {
    const config = await window.electronAPI.getConfig();
    modelDirInput.value = config.modelDir || '';
    modal.classList.remove('hidden');
  });

  cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

  browseBtn.addEventListener('click', async () => {
    const dir = await window.electronAPI.openFolderDialog();
    if (dir) modelDirInput.value = dir;
  });

  saveBtn.addEventListener('click', async () => {
    await window.electronAPI.saveConfig({ modelDir: modelDirInput.value.trim() });
    // saveConfig triggers a full window reload — nothing after this line runs
  });
}
