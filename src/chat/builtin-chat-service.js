/**
 * builtin-chat-service.js — Default chat service implementation.
 * Delegates to the LLM module via injected dependencies.
 * Receives `llmInput` and `llmOutputStream` from the caller (core.js).
 */
import { ChatService } from './chat-service.js';
import { stopTTS, speak } from '../tts/tts.js';

export class BuiltinChatService extends ChatService {
  /**
   * @param {(text: string) => void} llmInput
   * @param {{ on: Function, off: Function }} llmOutputStream
   */
  constructor(llmInput, llmOutputStream) {
    super();
    this._input  = llmInput;
    this._stream = llmOutputStream;
  }

  send(message, onChunk, onDone, onError) {
    // Cancel previous in-flight display and TTS so only this send drives the UI.
    // The previous LLM call still runs to completion and appends to history.
    if (this._cleanup) { this._cleanup(); this._cleanup = null; stopTTS(); }

    const input        = this._input;
    const outputStream = this._stream;
    const onData = (chunk) => onChunk(chunk);

    let accumulated = '';

    const cleanup = () => {
      outputStream.off('data',  onData);
      outputStream.off('end',   onEnd);
      outputStream.off('error', onErr);
    };

    const onEnd = () => {
      cleanup(); this._cleanup = null;
      if (accumulated.trim()) speak(accumulated.trim());
      onDone();
    };
    const onErr = (err) => { cleanup(); this._cleanup = null; onError(err); };

    this._cleanup = cleanup;

    // Wrap onData to also accumulate for TTS
    outputStream.on('data', (chunk) => { accumulated += chunk; onChunk(chunk); });
    outputStream.on('end',   onEnd);
    outputStream.on('error', onErr);

    input(message);
  }
}
