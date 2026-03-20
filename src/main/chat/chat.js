/**
 * chat.js — Chat facade. Runs in the main process.
 *
 * Manages the active chat service. Each service provides its own entry
 * point (e.g. handleBuiltinChatMessage for the renderer chat box).
 */
const { BuiltinChatService } = require('./builtin-chat-service.js');

const SERVICES = {
  'builtin': BuiltinChatService,
};
const DEFAULT_SERVICE = 'builtin';

let service = new BuiltinChatService();

function configureChat(chatConfig) {
  const key = chatConfig?.service || DEFAULT_SERVICE;
  const ServiceClass = SERVICES[key] || SERVICES[DEFAULT_SERVICE];
  service = new ServiceClass();
}

/**
 * Forward a message from the renderer’s built-in chat box.
 */
function handleBuiltinChatMessage(text) {
  return service.handleBuiltinChatMessage(text);
}

module.exports = { configureChat, handleBuiltinChatMessage };
