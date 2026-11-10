/**
 * remote-policy.js — what remote (relay) clients may do. Enforced on the PC.
 *
 * Remote browsers can chat, use the mic, and stop speech. They can never read
 * or change settings (get-config / save-config / copilot:* are not reachable),
 * so no secret ever leaves the PC.
 */

/** Push events forwarded to remote clients. Everything else stays local. */
const REMOTE_EVENTS = new Set([
  'chat:stream:start', 'chat:stream:data', 'chat:stream:end', 'chat:stream:error',
  'tts:start', 'tts:chunk', 'tts:end', 'tts:error', 'tts:stop',
  'stt:vad-state', 'stt:error',
  'model:status',
  'app:reload',
]);

/** Session id used for a remote client's STT (VAD) session. */
function remoteSession(clientId) { return `remote:${clientId}`; }

/**
 * Build the invoke handlers available to remote clients.
 * @param {{ appCore: object, getBootstrap: () => object }} deps
 * @returns {Record<string, (args:any, ctx:{ clientId:string }) => any>}
 */
function createRemoteInvokeHandlers({ appCore, getBootstrap }) {
  return {
    'app:bootstrap':     () => getBootstrap(),
    'chat:builtin-send': (args) => appCore.handleChatSend({ text: String((args && args.text) || '') }),
    'tts:stop':          () => appCore.handleTtsStop(),
    'stt:ready':         () => appCore.handleSttReady(),
    // Remote mic audio always arrives as 16 kHz Int16 (binary kind 2).
    'stt:start':         (_args, ctx) => appCore.handleSttStart({ sampleRate: 16000, format: 's16' }, remoteSession(ctx.clientId)),
    'stt:stop':          (_args, ctx) => appCore.handleSttStop(remoteSession(ctx.clientId)),
  };
}

module.exports = { REMOTE_EVENTS, remoteSession, createRemoteInvokeHandlers };
