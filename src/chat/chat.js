/**
 * chat.js — Chat UI and public interface.
 *
 * Injects the chat output window and input panel into the DOM.
 * The ChatService implementation is injected by the caller (core.js).
 *
 * Usage:
 *   import { initChat } from './chat/chat.js';
 *   initChat(service);
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

export function initChat(service) {
  document.body.insertAdjacentHTML('beforeend', CHAT_HTML);

  const outputText = document.getElementById('chat-output-text');
  const textarea   = document.getElementById('chat-textarea');
  const sendBtn    = document.getElementById('chat-send-btn');

  function send() {
    const message = textarea.value.trim();
    if (!message) return;

    textarea.value = '';
    textarea.style.height = '';
    outputText.textContent = '';
    sendBtn.disabled = true;

    service.send(
      message,
      (chunk) => { outputText.textContent += chunk; },
      ()      => { sendBtn.disabled = false; },
      (err)   => { outputText.textContent = `⚠ ${err.message}`; sendBtn.disabled = false; },
    );
  }

  sendBtn.addEventListener('click', send);

  textarea.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Auto-grow textarea as user types (up to CSS max-height)
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  });
}
