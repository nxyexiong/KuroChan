/**
 * openclaw-llm-service.js — OpenClaw gateway WebSocket implementation of LLMService.
 *
 * Connects to an OpenClaw gateway (default: ws://127.0.0.1:18789) and uses the
 * `chat.send` / `chat` event protocol to stream assistant replies.
 *
 * Protocol summary:
 *   1. WebSocket connects → server sends {type:"event", event:"connect.challenge", payload:{nonce}}
 *   2. Client sends connect request with auth → server responds with hello-ok
 *   3. Client sends {type:"req", method:"chat.send", params:{sessionKey, message, idempotencyKey}}
 *   4. Server responds with {status:"accepted"} immediately
 *   5. Server pushes {type:"event", event:"chat", payload:{runId, state, message, errorMessage}}
 *      – state "delta"  → append streamed text chunk
 *      – state "final"  → response complete
 *      – state "aborted"→ response cancelled (treat as done)
 *      – state "error"  → report error
 */
import { LLMService } from './llm-service.js';
import {
  signDevicePayload as _signDevicePayload,
  loadOrCreateDeviceIdentity as _loadOrCreateDeviceIdentity,
  buildConnectPayload,
} from './openclaw-device-identity.js';

const DEFAULT_URL = 'ws://127.0.0.1:18789';
const PROTOCOL_VERSION = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Extract plain text from an OpenClaw chat message payload.
 * message.content can be a string or an array of content blocks.
 */
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

/**
 * Return true when the hostname is a loopback address (IPv4, IPv6, or "localhost").
 */
function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '127.0.0.1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

export class OpenClawLLMService extends LLMService {
  constructor() {
    super();
    this._url        = DEFAULT_URL;
    this._token      = '';
    this._password   = '';
    this._sessionKey = 'main';

    /** @type {WebSocket|null} */
    this._ws         = null;
    /** Pending gateway requests: id → {resolve, reject, timeout} */
    this._pending    = new Map();
    /** True once the connect handshake succeeds. */
    this._connected  = false;
    /** True when the service has been permanently stopped (no reconnect). */
    this._stopped    = true;
    this._backoffMs  = 1000;

    /** Active streaming call: {runId, onChunk, onDone, onError, streamText} | null */
    this._activeStream = null;

    /** Cached device identity (loaded lazily on first connect). */
    this._deviceIdentity = null;
  }

  // ── LLMService interface ──────────────────────────────────────────────────

  configure({ openclaw = {} } = {}) {
    const newToken      = (openclaw.token      || '').trim();
    const newPassword   = (openclaw.password   || '').trim();
    const newSessionKey = (openclaw.sessionKey || 'main').trim() || 'main';
    const newUrl        = (openclaw.url        || DEFAULT_URL).trim() || DEFAULT_URL;

    const urlChanged = newUrl !== this._url;
    this._token      = newToken;
    this._password   = newPassword;
    this._sessionKey = newSessionKey;

    if (urlChanged || this._stopped) {
      this._url     = newUrl;
      this._stopped = false;
      this._backoffMs = 1000;
      this._closeWs();
      this._connect();
    }
    // If only credentials changed but URL is the same, the next chat.send will
    // use the new password automatically (re-connect happens on next close).
  }

  /**
   * Stream a response for the most-recent user message in `messages`.
   * OpenClaw maintains session history server-side, so only the latest
   * user turn needs to be forwarded.
   *
   * @param {{ role: string, content: string }[]} messages
   * @param {(chunk: string) => void} onChunk
   * @param {() => void} onDone
   * @param {(err: Error) => void} onError
   */
  stream(messages, onChunk, onDone, onError) {
    if (!this._connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) {
      onError(new Error('OpenClaw gateway is not connected. Check the URL in Settings.'));
      return;
    }

    // Find the last user message to send to the agent.
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) {
      onError(new Error('No user message found to forward to OpenClaw.'));
      return;
    }

    const runId = crypto.randomUUID();
    this._activeStream = { runId, onChunk, onDone, onError, streamText: '' };

    this._request('chat.send', {
      sessionKey:     this._sessionKey,
      message:        lastUser.content,
      idempotencyKey: runId,
    }).catch((err) => {
      // Only report the error if this stream is still the active one.
      if (this._activeStream?.runId === runId) {
        this._activeStream = null;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _connect() {
    if (this._stopped) return;

    // Security: block plaintext ws:// for non-loopback hosts (MITM / CWE-319).
    let parsedUrl;
    try {
      parsedUrl = new URL(this._url);
    } catch {
      console.error('[OpenClaw] Invalid gateway URL:', this._url);
      return;
    }
    if (parsedUrl.protocol === 'ws:' && !isLoopbackHost(parsedUrl.hostname)) {
      console.error(
        '[OpenClaw] Refusing plaintext ws:// connection to non-loopback host. ' +
        'Use wss:// for remote gateways.',
      );
      return;
    }

    const ws = new WebSocket(this._url);
    this._ws = ws;

    ws.addEventListener('message', (ev) => this._handleMessage(ev.data));

    ws.addEventListener('close', (ev) => {
      if (this._ws !== ws) return;
      this._ws        = null;
      this._connected = false;
      this._flushPendingErrors(new Error(`OpenClaw gateway closed (${ev.code})`));

      if (!this._stopped) {
        const delay    = this._backoffMs;
        this._backoffMs = Math.min(this._backoffMs * 2, MAX_BACKOFF_MS);
        setTimeout(() => this._connect(), delay);
      }
    });

    ws.addEventListener('error', () => {
      // Errors are followed by close; nothing extra needed here.
    });
  }

  _closeWs() {
    this._connected = false;
    const ws = this._ws;
    this._ws = null;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this._flushPendingErrors(new Error('OpenClaw gateway disconnected'));
  }

  _flushPendingErrors(err) {
    for (const [, p] of this._pending) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this._pending.clear();
  }

  // ── Message handling ──────────────────────────────────────────────────────

  _handleMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'event': this._handleEventFrame(frame); break;
      case 'res':   this._handleResponseFrame(frame); break;
    }
  }

  _handleEventFrame(frame) {
    const { event, payload } = frame;

    if (event === 'connect.challenge') {
      const nonce = payload?.nonce;
      if (typeof nonce === 'string' && nonce.trim()) {
        this._sendConnect(nonce.trim());
      }
      return;
    }

    if (event === 'chat') {
      this._handleChatEvent(payload);
    }
  }

  _handleChatEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    const stream = this._activeStream;
    if (!stream || payload.runId !== stream.runId) return;

    const { state, message, errorMessage } = payload;

    if (state === 'delta') {
      // delta events carry the full accumulated text so far, not just the new chunk.
      // Only emit the suffix that hasn't been sent yet.
      const fullText = extractTextFromMessage(message);
      if (fullText && fullText.length > stream.streamText.length) {
        const chunk = fullText.slice(stream.streamText.length);
        stream.streamText = fullText;
        stream.onChunk(chunk);
      }
    } else if (state === 'final') {
      this._activeStream = null;
      stream.onDone();
    } else if (state === 'aborted') {
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

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      const code = frame.error?.code || 'ERROR';
      const msg  = frame.error?.message || 'request failed';
      pending.reject(new Error(`${code}: ${msg}`));
    }
  }

  // ── Protocol requests ─────────────────────────────────────────────────────

  /**
   * Send the connect handshake, signing the server-provided nonce with the
   * device's Ed25519 private key so the gateway accepts the Control-UI client.
   */
  async _sendConnect(nonce) {
    // Load or generate the persistent device identity on first use.
    if (!this._deviceIdentity) {
      try {
        this._deviceIdentity = await _loadOrCreateDeviceIdentity();
      } catch (err) {
        console.warn('[OpenClaw] Could not load device identity:', err.message);
      }
    }

    // Full operator scopes sent by the Control UI — the payload signature must
    // cover the exact same comma-joined string, so define it once here.
    const role   = 'operator';
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];

    let device;
    const identity = this._deviceIdentity;
    if (identity) {
      try {
        const signedAtMs = Date.now();
        const payload = buildConnectPayload({
          deviceId: identity.deviceId,
          clientId: 'openclaw-control-ui',
          mode:     'webchat',
          role,
          scopes,
          signedAtMs,
          token:    this._token || '',
          nonce,
        });
        const signature = await _signDevicePayload(identity.privateKey, payload);
        device = { id: identity.deviceId, publicKey: identity.publicKey, signature, signedAt: signedAtMs, nonce };
      } catch (err) {
        console.error('[OpenClaw] Failed to sign device payload:', err.message);
      }
    }

    const auth = this._token
      ? { token: this._token }
      : this._password
        ? { password: this._password }
        : undefined;

    this._request('connect', {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id:       'openclaw-control-ui',
        version:  '1.0.0',
        platform: typeof navigator !== 'undefined' ? (navigator.platform || 'web') : 'web',
        mode:     'webchat',
      },
      device,
      caps:   ['tool-events'],
      role,
      scopes,
      auth,
    })
      .then(() => { this._connected = true; })
      .catch((err) => {
        console.error('[OpenClaw] Connect handshake failed:', err.message);
        // The socket close event will schedule a reconnect.
      });
  }

  /**
   * Send a request frame and return a promise that resolves with the response
   * payload or rejects on error / timeout.
   */
  _request(method, params) {
    return new Promise((resolve, reject) => {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('OpenClaw gateway not connected'));
        return;
      }

      const id      = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`OpenClaw gateway timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this._pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }
}
