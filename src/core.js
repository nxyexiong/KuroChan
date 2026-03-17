/**
 * core.js — Application bootstrap.
 *
 * Reads and parses the top-level config, then routes each config section to
 * the appropriate module initialiser. Add new modules here as the app grows.
 */

import { setStatus } from './ui.js';
import { loadModel } from './model/model.js';
import { configureLLM, outputStream as llmOutputStream, setMemory } from './llm/llm.js';
import { configureTTS, speak, stopTTS, ttsEvents } from './tts/tts.js';
import { configureSTT, initSTTButton } from './stt/stt.js';
import { setMouthOpen } from './model/model.js';
import { initChat } from './chat/chat.js';

export async function initCore() {
  const config = await window.electronAPI.getConfig();

  // ── General ──────────────────────────────────────────────────────────────
  await initGeneral(config.general ?? {});

  // ── Model ─────────────────────────────────────────────────────────────────
  await initModel(config.model ?? {});

  // ── LLM ───────────────────────────────────────────────────────────────────
  initLLM(config.llm ?? {});

  // ── Memory ────────────────────────────────────────────────────────────────
  const memory = await window.electronAPI.getMemory();
  setMemory(memory);

  // ── TTS ───────────────────────────────────────────────────────────────────
  initTTS(config.tts ?? {});

  // ── STT ───────────────────────────────────────────────────────────────────
  initSTT(config.stt ?? {});
  initSTTButton();

  // ── LLM → TTS ─────────────────────────────────────────────────────────────
  wireLLMToTTS();

  // ── TTS → Model (lip sync) ────────────────────────────────────────────────
  wireTTSToModel();

  // ── Chat ──────────────────────────────────────────────────────────────────
  initChat();
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

function initSTT(sttConfig) {
  configureSTT(sttConfig);
}


function wireLLMToTTS() {
  let accumulated = '';
  llmOutputStream.on('start', () => { stopTTS(); accumulated = ''; });
  llmOutputStream.on('data',  (chunk) => { accumulated += chunk; });
  llmOutputStream.on('end',   () => { if (accumulated.trim()) speak(accumulated.trim()); accumulated = ''; });
  llmOutputStream.on('error', () => { accumulated = ''; });
}

function wireTTSToModel() {
  // Real-time RMS volume from OpenAI TTS drives mouth directly
  ttsEvents.on('volume', (vol) => setMouthOpen(vol));
  ttsEvents.on('end',    ()    => setMouthOpen(0));
  ttsEvents.on('error',  ()    => setMouthOpen(0));
}
