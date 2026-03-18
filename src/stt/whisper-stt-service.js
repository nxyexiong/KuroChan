/**
 * whisper-stt-service.js — Local Whisper STT via koffi + whisper_kuro.dll.
 *
 * Responsibilities (only):
 *   1. Open the mic via getUserMedia + AudioWorklet
 *   2. Deliver raw Float32 PCM chunks to the caller via onChunk()
 *   3. Send a completed recording to whisper and return the transcript
 *
 * Voice Activity Detection is handled by the stt.js layer above, keeping
 * this class focused on the audio I/O and whisper IPC.
 */
import { STTService } from './stt-service.js';

const WORKLET_SRC = `
class KuroChanPCMCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length > 0) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor('kurochan-pcm-capture', KuroChanPCMCapture);
`;

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

export class WhisperSTTService extends STTService {
  constructor() {
    super();
    this._modelPath    = 'resources/whisper/ggml-base.bin';
    this._nThreads     = 4;
    this._language     = 'en';
    this._stream       = null;
    this._audioCtx     = null;
    this._source       = null;
    this._worklet      = null;
    this._sampleRate   = 44100;
    this._onChunk      = null;   // (Float32Array) => void — set by startListening
    this._pendingStop  = false;
  }

  configure({ whisper = {} } = {}) {
    if (whisper.modelPath != null) this._modelPath = whisper.modelPath;
    if (whisper.nThreads  != null) this._nThreads  = whisper.nThreads;
    if (whisper.language  != null) this._language  = whisper.language;
  }

  getModelPath() { return this._modelPath; }

  /**
   * Open mic and start delivering raw PCM chunks.
   * @param {(chunk: Float32Array) => void} onChunk  - called per worklet frame (~128 samples)
   * @param {(err: Error) => void}          onError
   */
  async startListening(onChunk, onError) {
    try {
      const { ok, error } = await window.electronAPI.sttCheck({ modelPath: this._modelPath });
      if (!ok) { onError(new Error(error)); return; }
    } catch (err) { onError(err); return; }

    this._onChunk     = onChunk;
    this._pendingStop = false;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      onError(err);
      return;
    }

    if (this._pendingStop) {
      stream.getTracks().forEach(t => t.stop());
      this._pendingStop = false;
      return;
    }

    this._stream = stream;

    try {
      const audioCtx = new AudioContext();
      this._audioCtx   = audioCtx;
      this._sampleRate = audioCtx.sampleRate;

      const blob       = new Blob([WORKLET_SRC], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source  = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'kurochan-pcm-capture');

      worklet.port.onmessage = (e) => this._onChunk?.(e.data);

      // Source → worklet only; NOT connected to destination (no mic playback).
      source.connect(worklet);

      this._source  = source;
      this._worklet = worklet;
    } catch (err) {
      console.error('[STT] AudioWorklet setup failed:', err);
      stream.getTracks().forEach(t => t.stop());
      this._stream   = null;
      this._audioCtx = null;
      onError(err);
    }
  }

  /** Tear down the mic immediately. */
  stopListening() {
    this._onChunk = null;

    if (!this._worklet) {
      this._pendingStop = true;
      return;
    }

    this._worklet.port.onmessage = null;
    try { this._source.disconnect();  } catch { /* ignore */ }
    try { this._worklet.disconnect(); } catch { /* ignore */ }
    this._source  = null;
    this._worklet = null;

    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
  }

  /**
   * Send accumulated Float32 chunks to whisper and resolve with the transcript.
   * @param {Float32Array[]} chunks
   * @returns {Promise<string>}
   */
  async transcribe(chunks) {
    const totalLen   = chunks.reduce((s, c) => s + c.length, 0);
    const allSamples = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) { allSamples.set(chunk, offset); offset += chunk.length; }

    const samples = resampleTo16k(allSamples, this._sampleRate);

    return window.electronAPI.sttTranscribe({
      samplesBuffer: samples.buffer,
      modelPath:     this._modelPath,
      nThreads:      this._nThreads,
      language:      this._language,
    });
  }
}

