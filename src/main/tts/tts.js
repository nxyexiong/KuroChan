/**
 * tts.js — TTS facade. Runs in main process.
 *
 * Selects the active TTS service and exposes the public API.
 * All shared logic (stream lifecycle, IPC, lip sync) lives in TTSService.
 */
const { OpenAITTSService } = require('./openai-tts-service.js');
const { XAITTSService }    = require('./xai-tts-service.js');
const { KokoroTTSService, shutdownWorker } = require('./kokoro-tts-service.js');

const SERVICES = {
  'kokoro':     KokoroTTSService,
  'openai-tts': OpenAITTSService,
  'xai-tts':    XAITTSService,
};
const DEFAULT_SERVICE = 'kokoro';

let service = new KokoroTTSService();

function configureTTS(ttsConfig) {
  const key = ttsConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  // Stop the previous service's resources (e.g. Kokoro's synthesis worker) before
  // replacing it, so reconfiguring doesn't leak worker threads.
  if (service && typeof service.dispose === 'function') { service.dispose(); }
  service = new ServiceClass();
  service.configure(ttsConfig);
}

function setTTSWindow(win)    { return service.setWindow(win); }
function speak(text)          { return service.speak(text); }
function beginSpeak()         { return service.begin(); }
function pushSpeak(text)      { return service.push(text); }
function endSpeak()           { return service.end(); }
function stopTTS()            { return service.stop(); }
function handleVolume(volume) { return service.handleVolume(volume); }

/**
 * Gracefully stop the local Kokoro synthesis worker before the app exits.
 * Targets the shared worker singleton directly (it may still be alive even if
 * the active service was switched away from Kokoro). Returns a Promise.
 */
function disposeTTS() { return shutdownWorker(); }

module.exports = { configureTTS, speak, beginSpeak, pushSpeak, endSpeak, stopTTS, setTTSWindow, handleVolume, disposeTTS };
