/**
 * remote-link.js — the PC's persistent outbound WebSocket to kurochan-server.
 *
 * Handles hello/welcome, heartbeat (ping every 30 s, terminate after 2 missed
 * pongs), reconnect with jittered exponential backoff (1 s → 30 s), and the
 * server's fatal close codes. TLS certificate verification is always on.
 *
 * Events:
 *   'state'        ('connecting' | 'online' | 'offline')
 *   'welcome'      ({ deviceId, username, clients })
 *   'client-join'  (clientId)       'client-leave' (clientId)
 *   'invoke'       ({ id, ch, args, from })
 *   'send'         ({ ch, args, from })
 *   'http'         ({ reqId, path, ifNoneMatch })
 *   'binary'       ({ kind, id, payload })
 *   'fatal'        (reason, code)   — link stopped; reason ∈ unbound|disabled|replaced|upgrade_required
 */
const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { encodeBinary, decodeBinary } = require('./remote-codec.js');

const PING_INTERVAL_MS = 30_000;
const MAX_MISSED_PONGS = 2;
const MAX_BUFFERED     = 1024 * 1024;
const BACKOFF_MIN_MS   = 1_000;
const BACKOFF_MAX_MS   = 30_000;

const FATAL_CLOSE = { 4401: 'unbound', 4403: 'disabled', 4409: 'replaced', 4426: 'upgrade_required' };

class RemoteLink extends EventEmitter {
  /**
   * @param {{ url:string, token:string, hello:object, wsOptions?:object }} opts
   */
  constructor({ url, token, hello, wsOptions = {} }) {
    super();
    this._url = url;
    this._token = token;
    this._hello = hello;
    this._wsOptions = wsOptions;
    this._ws = null;
    this._ready = false;
    this._stopped = true;
    this._attempt = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._missedPongs = 0;
  }

  start() {
    if (!this._stopped) return;
    this._stopped = false;
    this._connect();
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._teardown();
  }

  /** Reconnect now (e.g. after the device name changed, so hello is re-sent). */
  reconnect() {
    if (this._stopped) return;
    this._teardown();
    clearTimeout(this._reconnectTimer);
    this._connect();
  }

  setHello(hello) { this._hello = hello; }

  isOpen() { return this._ready && !!this._ws && this._ws.readyState === WebSocket.OPEN; }

  sendJSON(obj) {
    if (!this.isOpen()) return false;
    try { this._ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  /** Send a binary frame. `droppable` frames (audio) are skipped when the socket is congested. */
  sendBinary(kind, id, payload, { droppable = false } = {}) {
    if (!this.isOpen()) return false;
    if (droppable && this._ws.bufferedAmount > MAX_BUFFERED) return false;
    try { this._ws.send(encodeBinary(kind, id, payload)); return true; } catch { return false; }
  }

  /** Send a binary frame and resolve once it has been written (tunnel flow control). */
  sendBinaryAsync(kind, id, payload) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) { reject(new Error('link closed')); return; }
      this._ws.send(encodeBinary(kind, id, payload), (err) => (err ? reject(err) : resolve()));
    });
  }

  _connect() {
    this.emit('state', 'connecting');
    const ws = new WebSocket(this._url, {
      headers: { Authorization: `Bearer ${this._token}` },
      handshakeTimeout: 15_000,
      maxPayload: 1024 * 1024,
      ...this._wsOptions,
    });
    this._ws = ws;
    this._missedPongs = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', ...this._hello }));
      this._pingTimer = setInterval(() => {
        if (this._missedPongs >= MAX_MISSED_PONGS) { ws.terminate(); return; }
        this._missedPongs++;
        try { ws.ping(); } catch { /* closing */ }
      }, PING_INTERVAL_MS);
    });

    ws.on('pong', () => { this._missedPongs = 0; });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const frame = decodeBinary(data);
        if (frame) this.emit('binary', frame);
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
      this._onMessage(msg);
    });

    ws.on('close', (code) => {
      if (this._ws !== ws) return; // superseded by reconnect()
      this._clearSocket();
      const fatal = FATAL_CLOSE[code];
      if (fatal) {
        this._stopped = true;
        this.emit('fatal', fatal, code);
        return;
      }
      this.emit('state', 'offline');
      if (!this._stopped) this._scheduleReconnect();
    });

    // 'close' always follows 'error'; nothing else to do here.
    ws.on('error', () => {});
  }

  _onMessage(msg) {
    switch (msg && msg.t) {
      case 'welcome':
        this._ready = true;
        this._attempt = 0;
        this.emit('welcome', msg);
        this.emit('state', 'online');
        break;
      case 'client-join':  this.emit('client-join', msg.clientId); break;
      case 'client-leave': this.emit('client-leave', msg.clientId); break;
      case 'invoke':       this.emit('invoke', msg); break;
      case 'send':         this.emit('send', msg); break;
      case 'http':         this.emit('http', msg); break;
      default: break;
    }
  }

  _scheduleReconnect() {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** this._attempt);
    this._attempt++;
    const delay = base / 2 + Math.random() * (base / 2);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._stopped) this._connect();
    }, delay);
  }

  _clearSocket() {
    clearInterval(this._pingTimer);
    this._pingTimer = null;
    this._ready = false;
    this._ws = null;
  }

  _teardown() {
    const ws = this._ws;
    this._clearSocket();
    if (ws) {
      ws.removeAllListeners('message');
      ws.on('error', () => {});
      try { ws.close(1000); } catch { /* ignore */ }
      setTimeout(() => { try { ws.terminate(); } catch { /* ignore */ } }, 2000).unref?.();
    }
  }
}

module.exports = { RemoteLink, FATAL_CLOSE };
