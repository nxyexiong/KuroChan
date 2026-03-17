/**
 * chat-service.js — Abstract interface for chat backend services.
 * Subclass this to add different chat implementations.
 */
export class ChatService {
  /**
   * Send a message and stream the response.
   * @param {string} message
   * @param {(chunk: string) => void} onChunk  called for each streamed text chunk
   * @param {() => void} onDone                called when the response is complete
   * @param {(err: Error) => void} onError     called on error
   */
  send(message, onChunk, onDone, onError) {
    throw new Error('ChatService.send() must be implemented');
  }
}
