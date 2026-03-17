/**
 * builtin-chat-service.js — Default chat service implementation.
 * Delegates to the LLM module via injected dependencies.
 * Receives `llmInput` and `llmOutputStream` from the caller (core.js).
 */
import { ChatService } from './chat-service.js';

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
    const input        = this._input;
    const outputStream = this._stream;
    const onData = (chunk) => onChunk(chunk);

    const cleanup = () => {
      outputStream.off('data',  onData);
      outputStream.off('end',   onEnd);
      outputStream.off('error', onErr);
    };

    const onEnd = () => { cleanup(); onDone(); };
    const onErr = (err) => { cleanup(); onError(err); };

    outputStream.on('data',  onData);
    outputStream.on('end',   onEnd);
    outputStream.on('error', onErr);

    input(message);
  }
}
