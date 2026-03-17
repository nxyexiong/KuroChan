/**
 * stt-service.js — Abstract interface for STT backend services.
 * Subclass this to add support for different STT providers.
 */
export class STTService {
  configure(config) {
    throw new Error('STTService.configure() must be implemented');
  }

  /** Start capturing microphone audio. Calls onTranscript(text) when done. */
  startListening(onTranscript, onError) {
    throw new Error('STTService.startListening() must be implemented');
  }

  /** Stop capturing and trigger transcription of what was recorded so far. */
  stopListening() {
    throw new Error('STTService.stopListening() must be implemented');
  }
}
