const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STTService } = require('../src/main/stt/stt-service.js');

class FakeSTT extends STTService {
  constructor() {
    super();
    this.calls = [];
    this.active = 0;
    this.maxActive = 0;
  }
  available() { return true; }
  async transcribe(buffer) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((r) => setTimeout(r, 20));
    this.active--;
    const n = new Float32Array(buffer).length;
    this.calls.push(n);
    return `heard ${n}`;
  }
}

function makeService() {
  const sent = [];
  const svc = new FakeSTT();
  svc.setWindow({ isDestroyed: () => false, webContents: { send: (ch, data, opts) => sent.push({ ch, data, to: opts && opts.to }) } });
  svc.configure({ vad: { voiceThreshold: 0.1, silenceDuration: 0 } }, {});
  return { svc, sent };
}

const loudF32 = (n) => new Float32Array(n).fill(0.5).buffer;
const quietF32 = (n) => new Float32Array(n).buffer;
function loudS16(n) { const a = new Int16Array(n).fill(16000); return a.buffer; }
function quietS16(n) { return new Int16Array(n).buffer; }

test('concurrent sessions keep separate VAD state, route events to their owner, and transcribe serially', async () => {
  const { svc, sent } = makeService();
  const transcripts = [];
  let speechStarts = 0;
  svc.setOnTranscript((t) => transcripts.push(t));
  svc.setOnSpeechStart(() => speechStarts++);

  svc.startListening(16000, 'local', 'f32');
  svc.startListening(16000, 'remote:abc', 's16');

  // Both start talking, interleaved.
  svc.handleAudioChunk(loudF32(160), 'local');
  svc.handleAudioChunk(loudS16(320), 'remote:abc');
  svc.handleAudioChunk(loudF32(160), 'local');
  // Silence ends both utterances (silenceDuration 0 → second quiet chunk triggers).
  svc.handleAudioChunk(quietF32(160), 'local');
  svc.handleAudioChunk(quietS16(320), 'remote:abc');
  svc.handleAudioChunk(quietF32(160), 'local');
  svc.handleAudioChunk(quietS16(320), 'remote:abc');

  await new Promise((r) => setTimeout(r, 120));

  assert.equal(speechStarts, 2);
  assert.equal(svc.maxActive, 1, 'transcriptions must not overlap');
  assert.deepEqual(svc.calls.sort((a, b) => a - b), [640, 960]);
  assert.equal(transcripts.length, 2);

  const states = (to) => sent.filter((e) => e.ch === 'stt:vad-state' && e.to === to).map((e) => e.data.state);
  assert.deepEqual(states('local'), ['idle', 'speech', 'processing', 'idle']);
  assert.deepEqual(states('remote:abc'), ['idle', 'speech', 'processing', 'idle']);
});

test('stopListening flushes an in-progress utterance and ignores unknown sessions', async () => {
  const { svc, sent } = makeService();
  const transcripts = [];
  svc.setOnTranscript((t) => transcripts.push(t));
  svc.startListening(16000, 'remote:x', 's16');
  svc.handleAudioChunk(loudS16(100), 'remote:x');
  svc.stopListening('remote:x');
  svc.stopListening('remote:none');
  svc.handleAudioChunk(loudS16(100), 'remote:x'); // after stop: ignored
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(transcripts, ['heard 100']);
  assert.ok(sent.every((e) => e.to === 'remote:x'));
});

test('transcription errors are reported only to the owning session', async () => {
  const { svc, sent } = makeService();
  svc.transcribe = () => Promise.reject(new Error('boom'));
  svc.startListening(16000, 'remote:y', 's16');
  svc.handleAudioChunk(loudS16(100), 'remote:y');
  svc.stopListening('remote:y');
  await new Promise((r) => setTimeout(r, 20));
  const errors = sent.filter((e) => e.ch === 'stt:error');
  assert.deepEqual(errors.map((e) => [e.to, e.data.message]), [['remote:y', 'boom']]);
});
