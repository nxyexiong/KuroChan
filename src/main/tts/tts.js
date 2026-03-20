/**
 * tts.js — TTS facade. Runs in main process.
 *
 * Selects the active TTS service and exposes the public API.
 * All shared logic (stream lifecycle, IPC, lip sync) lives in TTSService.
 */
const { OpenAITTSService } = require('./openai-tts-service.js');
const { XAITTSService }    = require('./xai-tts-service.js');

const SERVICES = {
  'openai-tts': OpenAITTSService,
  'xai-tts':    XAITTSService,
};
const DEFAULT_SERVICE = 'openai-tts';

let service = new OpenAITTSService();

function configureTTS(ttsConfig) {
  const key = ttsConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  service = new ServiceClass();
  service.configure(ttsConfig);
}

function setTTSWindow(win)    { return service.setWindow(win); }
function speak(text)          { return service.speak(text); }
function stopTTS()            { return service.stop(); }
function handleVolume(volume) { return service.handleVolume(volume); }

module.exports = { configureTTS, speak, stopTTS, setTTSWindow, handleVolume };
