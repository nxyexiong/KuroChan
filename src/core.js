/**
 * core.js — Application bootstrap.
 *
 * Reads and parses the top-level config, then routes each config section to
 * the appropriate module initialiser. Add new modules here as the app grows.
 */

import { setStatus } from './ui.js';
import { loadModel } from './model/model.js';
import { configureLLM, input as llmInput, outputStream as llmOutputStream } from './llm/llm.js';
import { configureTTS, speak, ttsEvents } from './tts/tts.js';
import { setMouthOpen } from './model/model.js';
import { BuiltinChatService } from './chat/builtin-chat-service.js';
import { initChat } from './chat/chat.js';

export async function initCore() {
  const config = await window.electronAPI.getConfig();

  // ── General ──────────────────────────────────────────────────────────────
  await initGeneral(config.general ?? {});

  // ── Model ─────────────────────────────────────────────────────────────────
  await initModel(config.model ?? {});

  // ── LLM ───────────────────────────────────────────────────────────────────
  initLLM(config.llm ?? {});

  // ── TTS ───────────────────────────────────────────────────────────────────
  initTTS(config.tts ?? {});

  // ── LLM → TTS ─────────────────────────────────────────────────────────────
  wireLLMToTTS();

  // ── TTS → Model (lip sync) ────────────────────────────────────────────────
  wireTTSToModel();

  // ── Chat ──────────────────────────────────────────────────────────────────
  initChatModule();
}

// ── Section initialisers ──────────────────────────────────────────────────────

async function initGeneral(_generalConfig) {
  // reserved for future general settings
}

async function initModel({ modelPath }) {
  if (!modelPath) {
    setStatus('⚙ No model found — click ⚙ to choose a model folder');
    return;
  }
  await loadModel(modelPath);
}

function initLLM(llmConfig) {
  configureLLM(llmConfig);
}

function initTTS(ttsConfig) {
  configureTTS(ttsConfig);
}

function wireLLMToTTS() {
  let pendingReply = '';

  llmOutputStream.on('data', (chunk) => {
    pendingReply += chunk;
  });

  llmOutputStream.on('end', () => {
    const text = pendingReply.trim();
    pendingReply = '';
    if (text) speak(text);
  });

  llmOutputStream.on('error', () => {
    pendingReply = '';
  });
}

function initChatModule() {
  const service = new BuiltinChatService(llmInput, llmOutputStream);
  initChat(service);
}

function wireTTSToModel() {
  // Real-time RMS volume from OpenAI TTS drives mouth directly
  ttsEvents.on('volume', (vol) => setMouthOpen(vol));
  ttsEvents.on('end',    ()    => setMouthOpen(0));
  ttsEvents.on('error',  ()    => setMouthOpen(0));
}
