/**
 * ipc-channels.js — Shared IPC channel names between main and renderer.
 *
 * All cross-process communication goes through these named channels.
 * Main process registers handlers; renderer calls via window.electronAPI.
 */

// ── Config / system ───────────────────────────────────────────────────────────
export const GET_CONFIG        = 'get-config';
export const SAVE_CONFIG       = 'save-config';
export const OPEN_FOLDER_DIALOG = 'open-folder-dialog';
export const OPEN_FILE_DIALOG  = 'open-file-dialog';
export const GET_MEMORY        = 'get-memory';
export const SAVE_MEMORY       = 'save-memory';
export const CLOSE_WINDOW      = 'close-window';

// ── Chat ──────────────────────────────────────────────────────────────────────
/** renderer → main: send a user chat message (string) */
export const CHAT_SEND         = 'chat:send';
/** renderer → main: request session summary before closing */
export const CHAT_SUMMARIZE    = 'chat:summarize';

// main → renderer (push events via webContents.send):
export const CHAT_STREAM_START = 'chat:stream:start';
export const CHAT_STREAM_DATA  = 'chat:stream:data';
export const CHAT_STREAM_END   = 'chat:stream:end';
export const CHAT_STREAM_ERROR = 'chat:stream:error';

// ── TTS ───────────────────────────────────────────────────────────────────────
/** renderer → main: stop current speech */
export const TTS_STOP          = 'tts:stop';

// main → renderer (push events):
export const TTS_PLAY          = 'tts:play';      // { audioBase64 } — full MP3 blob
export const TTS_END           = 'tts:end';
export const TTS_ERROR         = 'tts:error';

// ── STT ───────────────────────────────────────────────────────────────────────
/** renderer → main: start mic capture */
export const STT_START         = 'stt:start';
/** renderer → main: stop mic capture */
export const STT_STOP          = 'stt:stop';
/** renderer → main: raw Float32 PCM audio chunk from AudioWorklet */
export const STT_AUDIO_CHUNK   = 'stt:audio-chunk';

// main → renderer (push events):
export const STT_VAD_STATE     = 'stt:vad-state';   // { state: 'idle'|'speech'|'processing' }
export const STT_ERROR         = 'stt:error';        // { message }
export const STT_READY         = 'stt:ready';        // { available: boolean }

// ── Model ─────────────────────────────────────────────────────────────────────
// main → renderer (push events):
export const MODEL_SET_PARAM   = 'model:set-parameter'; // { id, value, weight }
export const MODEL_STATUS      = 'model:status';        // { text }
