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

import { startListening, stopListening, sttEvents, sttAvailable } from '../stt/stt.js';
import { setStatus, hideStatusAfter } from '../ui.js';

const CHAT_HTML = `
<div id="chat-panel">
  <div id="chat-output"><span id="chat-output-text"></span></div>
  <div id="chat-input-area">
    <textarea id="chat-textarea" placeholder="Type a message…" rows="3"></textarea>
    <button id="chat-mic-btn" title="Hold to record" aria-label="Record voice">&#127908;</button>
    <button id="chat-send-btn">Send</button>
  </div>
</div>
`;

export function initChat(service) {
  document.body.insertAdjacentHTML('beforeend', CHAT_HTML);

  const outputText = document.getElementById('chat-output-text');
  const textarea   = document.getElementById('chat-textarea');
  const sendBtn    = document.getElementById('chat-send-btn');
  const micBtn     = document.getElementById('chat-mic-btn');

  // Hide mic button if STT is not configured
  if (!sttAvailable()) micBtn.style.display = 'none';

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

  // ── Mic button ──────────────────────────────────────────────────────────
  let recording = false;

  micBtn.addEventListener('click', () => {
    if (!recording) {
      recording = true;
      micBtn.classList.add('recording');
      micBtn.title = 'Click to stop recording';
      startListening();
    } else {
      recording = false;
      micBtn.classList.remove('recording');
      micBtn.title = 'Hold to record';
      stopListening();
    }
  });

  sttEvents.on('transcript', (text) => {
    textarea.value = text;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
    // Auto-send transcript as a message
    send();
  });

  sttEvents.on('error', (err) => {
    setStatus(`⚠ STT: ${err.message}`);
    hideStatusAfter(6000);
    recording = false;
    micBtn.classList.remove('recording');
  });

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
