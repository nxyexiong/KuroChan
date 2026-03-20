/**
 * stt.js — STT facade + VAD logic. Runs in main process.
 *
 * Receives raw PCM audio chunks from the renderer via IPC.
 * Performs VAD (voice activity detection) and transcription.
 * Feeds transcripts into the chat service via onTranscript callback.
 */
const fs = require('fs');

let _vadThreshold = 0.02;
let _vadSilenceMs = 1500;
let _vadState     = 'idle';
let _recordingChunks = [];
let _silenceStart = null;
let _sampleRate   = 44100;

let _modelPath = '';
let _nThreads  = 4;
let _language  = 'en';
let _listening = false;

/** @type {import('electron').BrowserWindow | null} */
let _win = null;
/** @type {((text: string) => void) | null} */
let _onTranscript = null;
/** @type {((opts: Object) => Promise<string>) | null} - whisper transcribe fn from main */
let _transcribeFn = null;

function setWindow(win) { _win = win; }
function setOnTranscript(fn) { _onTranscript = fn; }

function _send(channel, data) {
  if (_win && !_win.isDestroyed()) _win.webContents.send(channel, data);
}

/**
 * @param {Object} sttConfig
 * @param {Object} deps - { transcribe }
 */
function configureSTT(sttConfig, deps) {
  const vad = sttConfig?.vad ?? {};
  if (vad.voiceThreshold != null) _vadThreshold = Number(vad.voiceThreshold);
  if (vad.silenceDuration != null) _vadSilenceMs = Number(vad.silenceDuration);

  const whisper = sttConfig?.whisper ?? {};
  if (whisper.modelPath != null) _modelPath = whisper.modelPath;
  if (whisper.nThreads  != null) _nThreads  = whisper.nThreads;
  if (whisper.language   != null) _language  = whisper.language;

  if (deps?.transcribe) _transcribeFn = deps.transcribe;
}

function sttAvailable() { return !!_modelPath && !!_transcribeFn; }

function startListening(sampleRate) {
  _listening = true;
  _sampleRate = sampleRate || 44100;
  _vadState = 'idle';
  _recordingChunks = [];
  _silenceStart = null;
  _setVadState('idle');
  return true;
}

function stopListening() {
  _listening = false;
  _vadState = 'idle';
  _recordingChunks = [];
  _silenceStart = null;
}

function _setVadState(s) {
  _vadState = s;
  _send('stt:vad-state', { state: s });
}

function computeRMS(chunk) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  return Math.sqrt(sum / chunk.length);
}

function resampleTo16k(channelData, srcRate) {
  if (srcRate === 16000) return channelData;
  const ratio  = srcRate / 16000;
  const outLen = Math.floor(channelData.length / ratio);
  const out    = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos  = i * ratio;
    const idx  = Math.floor(pos);
    const frac = pos - idx;
    const a    = channelData[idx]     ?? 0;
    const b    = channelData[idx + 1] ?? a;
    out[i]     = a + frac * (b - a);
  }
  return out;
}

/**
 * Handle a raw PCM Float32 audio chunk from the renderer.
 * @param {ArrayBuffer} buffer - raw Float32 PCM samples
 */
function handleAudioChunk(buffer) {
  if (!_listening) return;
  const chunk = new Float32Array(buffer);
  const rms = computeRMS(chunk);

  if (_vadState === 'idle') {
    if (rms > _vadThreshold) {
      _recordingChunks = [Float32Array.from(chunk)];
      _silenceStart = null;
      _setVadState('speech');
    }
  } else if (_vadState === 'speech') {
    _recordingChunks.push(Float32Array.from(chunk));
    if (rms > _vadThreshold) {
      _silenceStart = null;
    } else {
      if (_silenceStart === null) {
        _silenceStart = Date.now();
      } else if (Date.now() - _silenceStart >= _vadSilenceMs) {
        const chunks = _recordingChunks;
        _recordingChunks = [];
        _silenceStart = null;
        _setVadState('processing');
        _transcribeChunks(chunks).then(
          (text) => {
            _setVadState('idle');
            if (text && _onTranscript) _onTranscript(text);
          },
          (err) => {
            _setVadState('idle');
            _send('stt:error', { message: err.message });
          },
        );
      }
    }
  }
}

async function _transcribeChunks(chunks) {
  if (!_transcribeFn) throw new Error('Whisper transcribe not available');

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const allSamples = new Float32Array(totalLen);
  let offset = 0;
  for (const c of chunks) { allSamples.set(c, offset); offset += c.length; }

  const samples = resampleTo16k(allSamples, _sampleRate);

  return _transcribeFn({
    samplesBuffer: samples.buffer,
    modelPath: _modelPath,
    nThreads: _nThreads,
    language: _language,
  });
}

module.exports = {
  configureSTT,
  sttAvailable,
  startListening,
  stopListening,
  handleAudioChunk,
  setWindow,
  setOnTranscript,
};
