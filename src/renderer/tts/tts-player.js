/**
 * tts-player.js — TTS audio playback (renderer).
 *
 * Receives chunked audio from main via IPC and plays it progressively.
 * Supports two formats selected at stream start:
 *   - 'aac'  → MediaSource API with AAC SourceBuffer
 *   - 'pcm'  → Web Audio API scheduling (24 kHz, 16-bit LE, mono)
 * An AnalyserNode provides real-time volume metering for lip sync.
 */

const AAC_MIME       = 'audio/aac';
const PCM_SAMPLE_RATE = 24000;

let _audioCtx     = null;
let _analyser     = null;
let _animFrame    = null;
let _format       = 'aac';

// ── AAC state ──────────────────────────────────────────────────────────────
let _audioEl      = null;
let _elSource     = null;
let _mediaSource  = null;
let _sourceBuffer = null;
let _queue        = [];
let _streamEnded  = false;

// ── PCM state ──────────────────────────────────────────────────────────────
let _gain         = null;
let _nextTime     = 0;
let _pcmPlaying   = false;
let _rate         = 1;

function _getAudioContext() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

// ── AAC helpers ────────────────────────────────────────────────────────────
function _stopAAC() {
  if (_audioEl) {
    _audioEl.pause();
    _audioEl.removeAttribute('src');
    _audioEl.load();
  }
  if (_mediaSource && _mediaSource.readyState === 'open') {
    try { _mediaSource.endOfStream(); } catch { /* */ }
  }
  _mediaSource  = null;
  _sourceBuffer = null;
  _queue        = [];
  _streamEnded  = false;
}

function _flushQueue() {
  if (!_sourceBuffer || _sourceBuffer.updating || _queue.length === 0) return;
  _sourceBuffer.appendBuffer(_queue.shift());
}

// ── PCM helpers ────────────────────────────────────────────────────────────
function _stopPCM() {
  _nextTime   = 0;
  _pcmPlaying = false;
  _rate       = 1;
}

function _int16ToFloat32(pcmBytes) {
  const int16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

// ── Shared ─────────────────────────────────────────────────────────────────
function _stopPlayback() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  _stopAAC();
  _stopPCM();
}

function _pumpVolume() {
  if (!_analyser) return;
  const data = new Float32Array(_analyser.fftSize);
  _analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  const scaled = Math.min(1, rms * 4);
  window.electronAPI.ttsVolume(scaled);
  _animFrame = requestAnimationFrame(_pumpVolume);
}

export function initTTSPlayer() {
  const ctx = _getAudioContext();

  // ── AAC one-time setup ───────────────────────────────────────────────────
  _audioEl  = new Audio();
  _elSource = ctx.createMediaElementSource(_audioEl);
  _analyser = ctx.createAnalyser();
  _analyser.fftSize = 2048;
  _elSource.connect(_analyser);
  _analyser.connect(ctx.destination);

  // PCM gain node also routes through the same analyser
  _gain = ctx.createGain();
  _gain.connect(_analyser);

  _audioEl.addEventListener('ended', () => {
    _stopPlayback();
    window.electronAPI.ttsVolume(0);
  });

  // ── Stream start ─────────────────────────────────────────────────────────
  window.electronAPI.onTTSStart(({ pitch, format }) => {
    _stopPlayback();
    _format = format || 'aac';

    const rate = (pitch && Math.abs(pitch) >= 0.01) ? Math.pow(2, pitch / 12) : 1;

    if (_format === 'pcm') {
      _rate = rate;
      _pcmPlaying = true;
      if (ctx.state === 'suspended') ctx.resume();
      _pumpVolume();
    } else {
      // AAC path
      _mediaSource = new MediaSource();
      _audioEl.src = URL.createObjectURL(_mediaSource);
      _audioEl.playbackRate = rate;
      _audioEl.preservesPitch = false;

      _mediaSource.addEventListener('sourceopen', () => {
        _sourceBuffer = _mediaSource.addSourceBuffer(AAC_MIME);
        _sourceBuffer.addEventListener('updateend', () => {
          _flushQueue();
          if (_streamEnded && _queue.length === 0 && !_sourceBuffer.updating) {
            try { _mediaSource.endOfStream(); } catch { /* */ }
          }
        });
        _flushQueue();
      });

      if (ctx.state === 'suspended') ctx.resume();
    }
  });

  // ── Stream chunk ─────────────────────────────────────────────────────────
  window.electronAPI.onTTSChunk(({ data }) => {
    if (_format === 'pcm') {
      if (!_pcmPlaying) return;

      const samples = _int16ToFloat32(new Uint8Array(data));
      if (samples.length === 0) return;

      const buffer = ctx.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = _rate;
      source.connect(_gain);

      const now = ctx.currentTime;
      if (_nextTime < now) _nextTime = now;
      source.start(_nextTime);
      _nextTime += buffer.duration / _rate;
    } else {
      // AAC path
      _queue.push(data);
      if (_audioEl.paused && _sourceBuffer && !_sourceBuffer.updating) {
        _flushQueue();
        _audioEl.play()
          .then(() => _pumpVolume())
          .catch((err) => console.error('[TTS Player] Play error:', err));
      } else {
        _flushQueue();
      }
    }
  });

  // ── Stream end ───────────────────────────────────────────────────────────
  window.electronAPI.onTTSEnd(() => {
    if (_format === 'pcm') {
      const remaining = Math.max(0, _nextTime - ctx.currentTime);
      setTimeout(() => {
        _stopPlayback();
        window.electronAPI.ttsVolume(0);
      }, remaining * 1000 + 100);
    } else {
      _streamEnded = true;
      if (_sourceBuffer && !_sourceBuffer.updating && _queue.length === 0) {
        try { _mediaSource.endOfStream(); } catch { /* */ }
      }
    }
  });

  // ── Stop / error ─────────────────────────────────────────────────────────
  window.electronAPI.onTTSStop(() => {
    _stopPlayback();
    window.electronAPI.ttsVolume(0);
  });

  window.electronAPI.onTTSError(({ message }) => {
    console.error('[TTS Player] Error from main:', message);
    _stopPlayback();
    window.electronAPI.ttsVolume(0);
  });
}
