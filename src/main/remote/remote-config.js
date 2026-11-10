/**
 * remote-config.js — fixed remote server address and protocol constants.
 * The server is intentionally a constant (not a user setting).
 */
const REMOTE_SERVER = 'https://kuro.abyssaldeath.com';
const REMOTE_WS_DEVICE = REMOTE_SERVER.replace(/^https:/, 'wss:') + '/ws/device';
const REMOTE_PROTOCOL = 1;

module.exports = { REMOTE_SERVER, REMOTE_WS_DEVICE, REMOTE_PROTOCOL };
