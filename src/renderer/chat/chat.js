/**
 * chat.js — Chat UI (renderer).
 *
 * Sends messages via IPC, displays streamed replies from main.
 * No knowledge of LLM, TTS, or STT.
 */

const CHAT_HTML = `
<div id="chat-panel">
  <div id="chat-output"><span id="chat-output-text"></span></div>
  <div id="chat-input-area">
    <textarea id="chat-textarea" placeholder="Type a message…" rows="3"></textarea>
    <button id="chat-send-btn">Send</button>
  </div>
</div>
`;

export function initChat() {
  document.body.insertAdjacentHTML('beforeend', CHAT_HTML);

  const outputText = document.getElementById('chat-output-text');
  const textarea   = document.getElementById('chat-textarea');

  // Listen for streamed reply from main
  window.electronAPI.onChatStreamStart(() => { outputText.textContent = ''; });
  window.electronAPI.onChatStreamData(({ chunk }) => { outputText.textContent += chunk; });
  window.electronAPI.onChatStreamError(({ message }) => { outputText.textContent = `⚠ ${message}`; });

  function send(message) {
    if (!message) return;
    window.electronAPI.chatBuiltinSend(message);
  }

  document.getElementById('chat-send-btn').addEventListener('click', () => {
    const message = textarea.value.trim();
    if (!message) return;
    textarea.value = '';
    textarea.style.height = '';
    send(message);
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const message = textarea.value.trim();
      if (!message) return;
      textarea.value = '';
      textarea.style.height = '';
      send(message);
    }
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });
}
