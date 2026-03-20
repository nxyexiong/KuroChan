/**
 * stt-ui.js — STT mic button UI (renderer).
 *
 * Captures mic audio via getUserMedia + AudioWorklet and sends raw PCM
 * chunks to the main process for VAD + transcription. No transcription
 * logic here.
 */

import { setStatus, hideStatusAfter } from '../ui.js';

let _sttOn = false;
let _stream = null;
let _audioCtx = null;
let _workletNode = null;

async function _startMicCapture() {
  _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _audioCtx = new AudioContext();
  const source = _audioCtx.createMediaStreamSource(_stream);

  // Register AudioWorklet for raw PCM chunks
  await _audioCtx.audioWorklet.addModule(_createWorkletURL());
  _workletNode = new AudioWorkletNode(_audioCtx, 'stt-capture-processor');
  source.connect(_workletNode);
  // Don't connect to destination — we don't want to hear the mic

  _workletNode.port.onmessage = (e) => {
    // e.data is Float32Array
    window.electronAPI.sttAudioChunk(e.data.buffer);
  };

  await window.electronAPI.sttStart(_audioCtx.sampleRate);
}

function _stopMicCapture() {
  window.electronAPI.sttStop();
  if (_workletNode) { _workletNode.disconnect(); _workletNode = null; }
  if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
}

/**
 * Create a Blob URL for the AudioWorkletProcessor.
 * Inline to avoid an extra file.
 */
function _createWorkletURL() {
  const code = `
    class STTCaptureProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];
        if (input && input[0]) {
          this.port.postMessage(new Float32Array(input[0]));
        }
        return true;
      }
    }
    registerProcessor('stt-capture-processor', STTCaptureProcessor);
  `;
  const blob = new Blob([code], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export async function initSTTButton() {
  const btn = document.getElementById('btn-mic');
  if (!btn) return;

  // Check if STT is available in main
  const { available } = await window.electronAPI.sttReady();
  if (!available) {
    btn.style.display = 'none';
    return;
  }

  btn.addEventListener('click', async () => {
    if (!_sttOn) {
      _sttOn = true;
      btn.classList.add('active');
      btn.title = 'Voice input (on — click to stop)';
      try {
        await _startMicCapture();
      } catch (err) {
        setStatus(`⚠ STT: ${err.message}`);
        hideStatusAfter(6000);
        _sttOn = false;
        btn.classList.remove('active', 'speech');
        btn.title = 'Voice input (off)';
      }
    } else {
      _sttOn = false;
      btn.classList.remove('active', 'speech');
      btn.title = 'Voice input (off)';
      _stopMicCapture();
    }
  });

  // VAD state from main
  window.electronAPI.onSTTVadState(({ state }) => {
    if (state === 'speech') {
      btn.classList.add('speech');
    } else {
      btn.classList.remove('speech');
    }
  });

  // STT errors from main
  window.electronAPI.onSTTError(({ message }) => {
    setStatus(`⚠ STT: ${message}`);
    hideStatusAfter(6000);
    if (_sttOn) {
      _sttOn = false;
      btn.classList.remove('active', 'speech');
      btn.title = 'Voice input (off)';
      _stopMicCapture();
    }
  });
}
