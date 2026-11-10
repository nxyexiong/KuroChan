/**
 * stt.js — STT facade. Runs in the main process.
 *
 * Selects the active STT service and exposes the public API.
 * All shared logic (VAD, resampling, audio pipeline) lives in STTService.
 */
const { WhisperSTTService } = require('./whisper-stt-service.js');

const SERVICES = {
  'whisper': WhisperSTTService,
};
const DEFAULT_SERVICE = 'whisper';

let service = new WhisperSTTService();

function configureSTT(sttConfig, deps) {
  const key = sttConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  service = new ServiceClass();
  service.configure(sttConfig, deps);
}

// `session` identifies the mic source: 'local' (desktop / LAN web) or
// 'remote:<clientId>' (a remote browser). Each session has its own VAD state.
function sttAvailable()                                     { return service.available(); }
function startListening(sampleRate, session = 'local', format = 'f32') { return service.startListening(sampleRate, session, format); }
function stopListening(session = 'local')                   { return service.stopListening(session); }
function handleAudioChunk(buffer, session = 'local')        { return service.handleAudioChunk(buffer, session); }
function setSTTWindow(win)                                  { return service.setWindow(win); }
function setOnTranscript(fn)         { return service.setOnTranscript(fn); }
function setOnSpeechStart(fn)        { return service.setOnSpeechStart(fn); }

module.exports = {
  configureSTT,
  sttAvailable,
  startListening,
  stopListening,
  handleAudioChunk,
  setSTTWindow,
  setOnTranscript,
  setOnSpeechStart,
};
