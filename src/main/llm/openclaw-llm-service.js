/**
 * openclaw-llm-service.js — OpenClaw gateway WebSocket implementation.
 * Runs in the main process using the ws package (Node.js WebSocket).
 */
const { LLMService } = require('./llm-service.js');
const {
  signDevicePayload,
  loadOrCreateDeviceIdentity,
  buildConnectPayload,
} = require('./openclaw-device-identity.js');

let WebSocket;
try { WebSocket = require('ws'); } catch { WebSocket = globalThis.WebSocket; }

const { randomUUID } = require('crypto');

const DEFAULT_URL = 'ws://127.0.0.1:18789';
const PROTOCOL_VERSION = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

function extractTextFromMessage(message) {
  if (!message || typeof message !== 'object') return '';
  const { content } = message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
  }
  return '';
}

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '127.0.0.1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

class OpenClawLLMService extends LLMService {
  constructor() {
    super();
    this._url        = DEFAULT_URL;
    this._token      = '';
    this._password   = '';
    this._sessionKey = 'main';
    this._ws         = null;
    this._pending    = new Map();
    this._connected  = false;
    this._stopped    = true;
    this._backoffMs  = 1000;
    this._activeStream = null;
    this._deviceIdentity = null;
  }

  _configure({ openclaw = {} } = {}) {
    const newToken      = (openclaw.token      || '').trim();
    const newPassword   = (openclaw.password   || '').trim();
    const newSessionKey = (openclaw.sessionKey || 'main').trim() || 'main';
    const newUrl        = (openclaw.url        || DEFAULT_URL).trim() || DEFAULT_URL;

    const urlChanged = newUrl !== this._url;
    this._token      = newToken;
    this._password   = newPassword;
    this._sessionKey = newSessionKey;

    if (urlChanged || this._stopped) {
      this._url = newUrl;
      this._stopped = false;
      this._backoffMs = 1000;
      this._closeWs();
      this._connect();
    }
  }

  stream(messages, onChunk, onDone, onError) {
    if (!this._connected || !this._ws || this._ws.readyState !== 1 /* OPEN */) {
      onError(new Error('OpenClaw gateway is not connected. Check the URL in Settings.'));
      return;
    }
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) { onError(new Error('No user message found.')); return; }

    const runId = randomUUID();
    this._activeStream = { runId, onChunk, onDone, onError, streamText: '' };

    this._request('chat.send', {
      sessionKey: this._sessionKey,
      message: lastUser.content,
      idempotencyKey: runId,
    }).catch((err) => {
      if (this._activeStream?.runId === runId) {
        this._activeStream = null;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  _connect() {
    if (this._stopped) return;
    let parsedUrl;
    try { parsedUrl = new URL(this._url); } catch {
      console.error('[OpenClaw] Invalid gateway URL:', this._url);
      return;
    }
    if (parsedUrl.protocol === 'ws:' && !isLoopbackHost(parsedUrl.hostname)) {
      console.error('[OpenClaw] Refusing plaintext ws:// to non-loopback host.');
      return;
    }

    const ws = new WebSocket(this._url);
    this._ws = ws;

    ws.on('message', (raw) => this._handleMessage(typeof raw === 'string' ? raw : raw.toString()));
    ws.on('close', (code) => {
      if (this._ws !== ws) return;
      this._ws = null;
      this._connected = false;
      this._flushPendingErrors(new Error(`OpenClaw closed (${code})`));
      if (!this._stopped) {
        const delay = this._backoffMs;
        this._backoffMs = Math.min(this._backoffMs * 2, MAX_BACKOFF_MS);
        setTimeout(() => this._connect(), delay);
      }
    });
    ws.on('error', () => {});
  }

  _closeWs() {
    this._connected = false;
    const ws = this._ws;
    this._ws = null;
    if (ws) { try { ws.close(); } catch {} }
    this._flushPendingErrors(new Error('OpenClaw disconnected'));
  }

  _flushPendingErrors(err) {
    for (const [, p] of this._pending) { clearTimeout(p.timeout); p.reject(err); }
    this._pending.clear();
  }

  _handleMessage(raw) {
    let frame;
    try { frame = JSON.parse(raw); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'event') this._handleEventFrame(frame);
    else if (frame.type === 'res') this._handleResponseFrame(frame);
  }

  _handleEventFrame(frame) {
    if (frame.event === 'connect.challenge') {
      const nonce = frame.payload?.nonce;
      if (typeof nonce === 'string' && nonce.trim()) this._sendConnect(nonce.trim());
      return;
    }
    if (frame.event === 'chat') this._handleChatEvent(frame.payload);
  }

  _handleChatEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    const stream = this._activeStream;
    if (!stream || payload.runId !== stream.runId) return;
    const { state, message, errorMessage } = payload;
    if (state === 'delta') {
      const fullText = extractTextFromMessage(message);
      if (fullText && fullText.length > stream.streamText.length) {
        stream.onChunk(fullText.slice(stream.streamText.length));
        stream.streamText = fullText;
      }
    } else if (state === 'final' || state === 'aborted') {
      this._activeStream = null;
      stream.onDone();
    } else if (state === 'error') {
      this._activeStream = null;
      stream.onError(new Error(errorMessage || 'OpenClaw agent error'));
    }
  }

  _handleResponseFrame(frame) {
    const pending = this._pending.get(frame.id);
    if (!pending) return;
    this._pending.delete(frame.id);
    clearTimeout(pending.timeout);
    if (frame.ok) pending.resolve(frame.payload);
    else pending.reject(new Error(`${frame.error?.code || 'ERROR'}: ${frame.error?.message || 'failed'}`));
  }

  _sendConnect(nonce) {
    if (!this._deviceIdentity) {
      try { this._deviceIdentity = loadOrCreateDeviceIdentity(); } catch (err) {
        console.warn('[OpenClaw] Could not load device identity:', err.message);
      }
    }
    const role = 'operator';
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];

    let device;
    const identity = this._deviceIdentity;
    if (identity) {
      try {
        const signedAtMs = Date.now();
        const payload = buildConnectPayload({
          deviceId: identity.deviceId, clientId: 'openclaw-control-ui',
          mode: 'webchat', role, scopes, signedAtMs,
          token: this._token || '', nonce,
        });
        const signature = signDevicePayload(identity.privateKey, payload);
        device = { id: identity.deviceId, publicKey: identity.publicKey, signature, signedAt: signedAtMs, nonce };
      } catch (err) { console.error('[OpenClaw] Failed to sign:', err.message); }
    }

    const auth = this._token ? { token: this._token }
      : this._password ? { password: this._password } : undefined;

    this._request('connect', {
      minProtocol: PROTOCOL_VERSION, maxProtocol: PROTOCOL_VERSION,
      client: { id: 'openclaw-control-ui', version: '1.0.0', platform: process.platform, mode: 'webchat' },
      device, caps: ['tool-events'], role, scopes, auth,
    })
      .then(() => { this._connected = true; this._backoffMs = 1000; })
      .catch((err) => { console.error('[OpenClaw] Connect failed:', err.message); });
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const ws = this._ws;
      if (!ws || ws.readyState !== 1) { reject(new Error('Not connected')); return; }
      const id = randomUUID();
      const timeout = setTimeout(() => { this._pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
}

module.exports = { OpenClawLLMService };
