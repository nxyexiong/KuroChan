/**
 * chat.js — Chat UI.
 *
 * Sends messages to the LLM and displays whatever the LLM streams back.
 * Has no knowledge of STT or TTS.
 */

import { input, outputStream } from '../llm/llm.js';

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

  outputStream.on('start', ()      => { outputText.textContent = ''; });
  outputStream.on('data',  (chunk) => { outputText.textContent += chunk; });
  outputStream.on('error', (err)   => { outputText.textContent = `⚠ ${err.message}`; });

  function send(message) {
    if (!message) return;
    input(message);
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

