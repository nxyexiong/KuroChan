/**
 * whisper-stt-service.js - Local Whisper STT via koffi + whisper_kuro.dll.
 *
 * Audio pipeline:
 *   getUserMedia -> AudioContext + AudioWorkletNode (raw Float32 PCM capture)
 *   -> resample to 16 kHz mono -> IPC to main process
 *   -> koffi calls kurochan_whisper_transcribe() -> transcript string
 *
 * AudioWorklet runs in the AudioWorkletGlobalScope — a dedicated thread
 * completely separate from both the renderer main thread and Chromium's native
 * audio mixer thread.  This avoids the ScriptProcessorNode access violations
 * AND the decodeAudioData crash that occur in Electron 28.
 * The worklet node is NOT connected to the audio destination so the mic is
 * never routed to the speakers.
 */
import { STTService } from './stt-service.js';

// Inline processor source loaded as a Blob URL so no extra file is needed.
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
    this._modelPath    = 'resources/whisper/ggml-base.en.bin';
    this._nThreads     = 4;
    this._language     = 'en';
    this._stream       = null;
    this._audioCtx     = null;
    this._source       = null;
    this._worklet      = null;
    this._pcmChunks    = [];
    this._sampleRate   = 44100;
    this._onTranscript = null;
    this._onError      = null;
    this._pendingStop  = false;
  }

  configure({ whisper = {} } = {}) {
    if (whisper.modelPath) this._modelPath = whisper.modelPath;
    if (whisper.nThreads)  this._nThreads  = whisper.nThreads;
    if (whisper.language)  this._language  = whisper.language;
  }

  getModelPath() { return this._modelPath; }

  async startListening(onTranscript, onError) {
    try {
      const { ok, error } = await window.electronAPI.sttCheck({ modelPath: this._modelPath });
      if (!ok) { onError(new Error(error)); return; }
    } catch (err) { onError(err); return; }

    this._onTranscript = onTranscript;
    this._onError      = onError;
    this._pendingStop  = false;
    this._pcmChunks    = [];

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

      // Load the worklet processor from a Blob URL
      const blob       = new Blob([WORKLET_SRC], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const source  = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'kurochan-pcm-capture');

      worklet.port.onmessage = (e) => {
        this._pcmChunks.push(e.data); // Float32Array(128) — raw PCM
      };

      // Connect source -> worklet only. NOT connected to destination, so
      // the mic audio is never played back. AudioWorklet still processes
      // because it has a live input connection.
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

  stopListening() {
    if (!this._worklet) {
      this._pendingStop = true;
      return;
    }

    // Unhook the message handler first so no new chunks arrive during teardown
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

    this._transcribe().then(this._onTranscript, this._onError);
  }

  async _transcribe() {
    const chunks = this._pcmChunks;
    this._pcmChunks = [];

    if (chunks.length === 0) throw new Error('No audio captured.');

    const totalLen   = chunks.reduce((s, c) => s + c.length, 0);
    const allSamples = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      allSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const samples = resampleTo16k(allSamples, this._sampleRate);

    const result = await window.electronAPI.sttTranscribe({
      samplesBuffer: samples.buffer,
      modelPath:     this._modelPath,
      nThreads:      this._nThreads,
      language:      this._language,
    });
    return result;
  }
}