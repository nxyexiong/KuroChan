/**
 * tts-player.js — TTS audio playback (renderer).
 *
 * Receives chunked AAC (ADTS) audio from main via IPC and plays it
 * progressively using the MediaSource API. An AnalyserNode provides
 * real-time volume metering for lip sync.
 */

const AAC_MIME = 'audio/aac';

let _audioCtx     = null;
let _audioEl      = null;
let _elSource     = null;
let _analyser     = null;
let _animFrame    = null;
let _mediaSource  = null;
let _sourceBuffer = null;
let _queue        = [];      // chunks waiting to be appended
let _streamEnded  = false;   // main says no more chunks

function _getAudioContext() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function _stopPlayback() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }

  if (_audioEl) {
    _audioEl.pause();
    _audioEl.removeAttribute('src');
    _audioEl.load();
  }

  if (_mediaSource && _mediaSource.readyState === 'open') {
    try { _mediaSource.endOfStream(); } catch { /* may already be ended */ }
  }
  _mediaSource  = null;
  _sourceBuffer = null;
  _queue        = [];
  _streamEnded  = false;
}

/** Append the next queued chunk if the SourceBuffer isn't busy. */
function _flushQueue() {
  if (!_sourceBuffer || _sourceBuffer.updating || _queue.length === 0) return;
  _sourceBuffer.appendBuffer(_queue.shift());
}

/** RMS volume metering → IPC to main for lip sync. */
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
  _audioEl = new Audio();

  // Wire <audio> → AnalyserNode → speakers (one-time setup)
  const ctx = _getAudioContext();
  _elSource = ctx.createMediaElementSource(_audioEl);
  _analyser = ctx.createAnalyser();
  _analyser.fftSize = 2048;
  _elSource.connect(_analyser);
  _analyser.connect(ctx.destination);

  _audioEl.addEventListener('ended', () => {
    _stopPlayback();
    window.electronAPI.ttsVolume(0);
  });

  // ── Stream start: prepare MediaSource ────────────────────────────────────
  window.electronAPI.onTTSStart(() => {
    _stopPlayback();

    _mediaSource = new MediaSource();
    _audioEl.src = URL.createObjectURL(_mediaSource);

    _mediaSource.addEventListener('sourceopen', () => {
      _sourceBuffer = _mediaSource.addSourceBuffer(AAC_MIME);
      _sourceBuffer.addEventListener('updateend', () => {
        _flushQueue();
        // If all chunks received and buffer drained, signal end of stream
        if (_streamEnded && _queue.length === 0 && !_sourceBuffer.updating) {
          try { _mediaSource.endOfStream(); } catch { /* */ }
        }
      });
      // Flush anything queued before sourceopen fired
      _flushQueue();
    });

    if (ctx.state === 'suspended') ctx.resume();
  });

  // ── Stream chunk: queue AAC data ────────────────────────────────────────
  window.electronAPI.onTTSChunk(({ data }) => {
    // data is a Uint8Array via structured clone
    _queue.push(data);

    // Start playback on first chunk
    if (_audioEl.paused && _sourceBuffer && !_sourceBuffer.updating) {
      _flushQueue();
      _audioEl.play()
        .then(() => _pumpVolume())
        .catch((err) => console.error('[TTS Player] Play error:', err));
    } else {
      _flushQueue();
    }
  });

  // ── Stream end: no more chunks ──────────────────────────────────────────
  window.electronAPI.onTTSEnd(() => {
    _streamEnded = true;
    // If nothing is queued/updating, close now
    if (_sourceBuffer && !_sourceBuffer.updating && _queue.length === 0) {
      try { _mediaSource.endOfStream(); } catch { /* */ }
    }
  });

  // ── Stop / error ────────────────────────────────────────────────────────
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
