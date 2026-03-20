/**
 * tts.js — TTS facade. Runs in main process.
 *
 * Streams AAC audio chunks to the renderer for progressive playback.
 * Every TTS service implementation outputs an AAC (ADTS) Readable stream.
 * Pitch adjustment is applied as a post-processing step via ffmpeg.
 * Owns lip sync: receives real-time volume from renderer and forwards
 * to the model service which converts it to Live2D parameters.
 */
const { spawn } = require('child_process');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const { OpenAITTSService } = require('./openai-tts-service.js');
const { setMouthOpen } = require('../model/model.js');

const SERVICES = { 'openai-tts': OpenAITTSService };
const DEFAULT_SERVICE = 'openai-tts';

let service = new OpenAITTSService();
let _pitch = 1.0;

/** @type {import('electron').BrowserWindow | null} */
let _win = null;
let _currentStream = null;
let _pitchProcess  = null;

function setWindow(win) { _win = win; }

function configureTTS(ttsConfig) {
  const key = ttsConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key];
  if (!ServiceClass) { service = new SERVICES[DEFAULT_SERVICE](); }
  else { service = new ServiceClass(); }
  service.configure(ttsConfig);
  if (ttsConfig?.pitch !== undefined) _pitch = ttsConfig.pitch;
}

function _send(channel, data) {
  if (_win && !_win.isDestroyed()) _win.webContents.send(channel, data);
}

/**
 * Pipe an AAC (ADTS) stream through ffmpeg to apply pitch shifting.
 * Returns a new Readable stream of pitch-adjusted AAC (ADTS) data.
 * Pitch is in semitones (e.g. 2.5 = 2.5 semitones up), matching the
 * original formula: rate = 2^(semitones/12).
 * If pitch is ~0, returns the input stream unchanged.
 * @param {Readable} inputStream  AAC (ADTS) input
 * @param {number}   semitones    Pitch shift in semitones
 * @returns {Readable}
 */
function _applyPitch(inputStream, semitones) {
  if (!semitones || Math.abs(semitones) < 0.01) return inputStream;

  // Convert semitones to rate multiplier: 2^(n/12)
  // Then use asetrate to reinterpret the sample rate (tape-speed pitch shift).
  const rateFactor = Math.pow(2, semitones / 12);
  const baseRate = 44100;
  const filter = `aresample=${baseRate},asetrate=${Math.round(baseRate * rateFactor)},aresample=${baseRate}`;

  const proc = spawn(ffmpegPath, [
    '-i', 'pipe:0',
    '-af', filter,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'adts',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  _pitchProcess = proc;

  const output = new Readable({ read() {} });

  proc.stdout.on('data', (chunk) => output.push(chunk));
  proc.stdout.on('end', () => output.push(null));
  proc.on('error', (err) => output.destroy(err));
  proc.on('close', () => { _pitchProcess = null; });

  inputStream.pipe(proc.stdin);
  inputStream.on('error', () => { proc.stdin.end(); });

  return output;
}

/**
 * Speak text: get an AAC stream from the service, apply pitch, and
 * forward chunks to renderer.
 * @param {string} text
 */
function speak(text) {
  // Stop any in-progress stream
  _killStreams();

  try {
    const rawStream = service.streamAudio(text);
    const stream = _applyPitch(rawStream, _pitch);
    _currentStream = stream;

    _send('tts:start', {});

    stream.on('data', (chunk) => {
      _send('tts:chunk', { data: new Uint8Array(chunk) });
    });

    stream.on('end', () => {
      _send('tts:end', {});
      _currentStream = null;
    });

    stream.on('error', (err) => {
      _send('tts:error', { message: err.message });
      setMouthOpen(0);
      _currentStream = null;
    });
  } catch (err) {
    _send('tts:error', { message: err.message });
    setMouthOpen(0);
  }
}

function _killStreams() {
  if (_currentStream) {
    _currentStream.destroy();
    _currentStream = null;
  }
  if (_pitchProcess) {
    _pitchProcess.kill('SIGTERM');
    _pitchProcess = null;
  }
}

function stopTTS() {
  service.abort();
  _killStreams();
  setMouthOpen(0);
  _send('tts:stop', {});
}

/**
 * Handle real-time volume reported by the renderer during audio playback.
 * Forwards to model service for lip sync.
 * @param {number} volume  0–1
 */
function handleVolume(volume) {
  setMouthOpen(volume);
}

module.exports = { configureTTS, speak, stopTTS, setWindow, handleVolume };
