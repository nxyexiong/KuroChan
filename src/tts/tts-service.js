/**
 * tts-service.js — Abstract interface for TTS backend services.
 * Subclass this to add support for different TTS providers.
 */
export class TTSService {
  /**
   * Configure the service (e.g. voice, rate, pitch, etc.)
   * @param {Object} config
   */
  configure(config) {
    throw new Error('TTSService.configure() must be implemented');
  }

  /**
   * Speak the given text.
   * @param {string} text
   * @param {() => void} onDone      called when speech finishes
   * @param {(err: Error) => void} onError  called on error
   * @returns {void}
   */
  speak(text, onDone, onError) {
    throw new Error('TTSService.speak() must be implemented');
  }

  /**
   * Stop any ongoing speech immediately.
   * @returns {void}
   */
  stop() {
    throw new Error('TTSService.stop() must be implemented');
  }
}
