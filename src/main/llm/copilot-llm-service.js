/**
 * copilot-llm-service.js — The LLM backend: GitHub Copilot via @github/copilot-sdk.
 *
 * KuroChan is Copilot-only. This service owns the whole LLM pipeline: it keeps a
 * persistent server-side Copilot session (conversation history lives in the CLI),
 * sends only the latest user message, and streams back ONLY assistant reply text —
 * reasoning and tool activity are intentionally suppressed.
 *
 * On-demand: configuring never spawns the CLI; the client/session start lazily and
 * asynchronously on the first message (or a Settings reset). Persistence: the
 * session id is written to the config file (via the injected onSessionId callback)
 * so the same conversation resumes across launches.
 */
const { approveAll } = require('@github/copilot-sdk');
const { createCopilotClient } = require('./copilot-auth.js');

const SEND_TIMEOUT_MS = 10 * 60 * 1000; // agentic turns (with tools) can run long

class CopilotLLMService {
  constructor() {
    this._soul            = '';
    this._token           = '';
    this._model           = '';
    this._reasoningEffort = null;
    this._contextTier     = 'default';
    this._sessionId       = null;
    this._provider        = null; // BYOK ProviderConfig (normalized) or null
    this._client          = null;
    this._session         = null;
    this._initPromise     = null;
    this._callId          = 0;
    this._onSessionId     = null; // (id: string|null) => void — persist to config
    this._activeCleanup   = null; // unsubscribes the current stream's session handlers
    this._abortPromise    = null; // in-flight session.abort(), awaited before the next send
  }

  /** Inject main-process dependencies (session-id persistence). */
  setDeps(deps = {}) {
    if (typeof deps.onSessionId === 'function') this._onSessionId = deps.onSessionId;
  }

  /**
   * Store config only — never starts the CLI here (on-demand contract).
   * Tears down any existing client if material settings changed so the next
   * message re-initializes with the new values.
   */
  configure(llmConfig) {
    this._soul = (llmConfig && llmConfig.character) || '';
    const c = (llmConfig && llmConfig.copilot) || {};
    const newToken   = (c.token || '').trim();
    const newModel   = (c.model || '').trim();
    const newEffort  = c.reasoningEffort || null;
    const newTier    = c.contextTier || 'default';
    const newSession = (c.sessionId || '').trim() || null;
    const newProvider = this._normalizeProvider(c.provider);
    const newProviderKey = newProvider ? JSON.stringify(newProvider) : '';

    const changed =
      newToken   !== this._token ||
      newModel   !== this._model ||
      newEffort  !== this._reasoningEffort ||
      newTier    !== this._contextTier ||
      newSession !== this._sessionId ||
      newProviderKey !== (this._provider ? JSON.stringify(this._provider) : '');

    this._token           = newToken;
    this._model           = newModel;
    this._reasoningEffort = newEffort;
    this._contextTier     = newTier;
    this._sessionId       = newSession;
    this._provider        = newProvider;

    if (changed) this._teardown();
  }

  /**
   * Normalize the raw `copilot.provider` config from settings into a clean
   * BYOK descriptor, or null when BYOK is disabled / no endpoint is set.
   */
  _normalizeProvider(raw) {
    const p = raw || {};
    const baseUrl = (p.baseUrl || '').trim();
    if (!p.enabled || !baseUrl) return null;
    const toPosInt = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : 0);
    return {
      type:    p.type || 'openai',
      baseUrl,
      apiKey:  (p.apiKey || '').trim(),
      model:   (p.model || '').trim(),
      wireApi: (p.wireApi || '').trim(),
      azureApiVersion: (p.azureApiVersion || '').trim(),
      reasoningEffort: (p.reasoningEffort || '').trim(),
      maxPromptTokens: toPosInt(p.maxPromptTokens),
      maxOutputTokens: toPosInt(p.maxOutputTokens),
    };
  }

  /** Build a CopilotClient appropriate for the active mode (BYOK vs GitHub). */
  _makeClient() {
    return this._provider
      ? createCopilotClient('', { noGitHubAuth: true })
      : createCopilotClient(this._token);
  }

  /**
   * Send a user message and stream the reply through the handlers. Stale-guarded:
   * a newer input() supersedes the callbacks of older in-flight requests.
   */
  input(text, { onStart, onData, onEnd, onError } = {}) {
    const myId = ++this._callId;
    let reply = '';
    if (onStart) onStart();
    this._send(
      text,
      (chunk) => { if (this._callId !== myId) return; reply += chunk; if (onData) onData(chunk); },
      ()      => { if (this._callId !== myId) return; if (onEnd) onEnd(reply); },
      (err)   => { if (this._callId !== myId) return; if (onError) onError(err); },
    );
  }

  /**
   * Abort the in-flight turn (barge-in): supersede pending callbacks, immediately
   * unsubscribe the current stream's session handlers (so its residual deltas
   * can't bleed into the next turn), and tell the Copilot session to stop
   * generating server-side. The session stays valid for the next message.
   */
  abort() {
    this._callId++; // stale-guard: in-flight _send callbacks become no-ops
    if (this._activeCleanup) { try { this._activeCleanup(); } catch { /* ignore */ } this._activeCleanup = null; }
    const session = this._session;
    if (session) {
      try { this._abortPromise = Promise.resolve(session.abort()).catch(() => {}); }
      catch { /* ignore */ }
    }
  }

  /** Build the SessionConfig / ResumeSessionConfig shared options. */
  _sessionConfig() {
    const config = {
      onPermissionRequest: approveAll, // auto-allow every tool
      streaming: true,                 // emit assistant.message_delta chunks as generated
    };
    if (this._provider) {
      // BYOK: route inference to the user's own endpoint. `model` is REQUIRED.
      const pv = { type: this._provider.type, baseUrl: this._provider.baseUrl };
      if (this._provider.apiKey)  pv.apiKey  = this._provider.apiKey;
      if (this._provider.wireApi) pv.wireApi = this._provider.wireApi;
      if (this._provider.type === 'azure' && this._provider.azureApiVersion) {
        pv.azure = { apiVersion: this._provider.azureApiVersion };
      }
      // The runtime can't infer a custom model's limits — let the user cap the
      // prompt (so the persistent conversation is compacted in time) and output.
      if (this._provider.maxPromptTokens) pv.maxPromptTokens = this._provider.maxPromptTokens;
      if (this._provider.maxOutputTokens) pv.maxOutputTokens = this._provider.maxOutputTokens;
      config.provider = pv;
      if (this._provider.model) config.model = this._provider.model;
      // Only meaningful if the custom model supports it (e.g. o-series, R1).
      if (this._provider.reasoningEffort) config.reasoningEffort = this._provider.reasoningEffort;
    } else {
      // GitHub Copilot: model + reasoning effort + context tier come from the
      // account's model metadata (default/long_context is a Copilot routing tier).
      if (this._model) config.model = this._model;
      if (this._reasoningEffort) config.reasoningEffort = this._reasoningEffort;
      if (this._contextTier) config.contextTier = this._contextTier;
    }
    if (this._soul) config.systemMessage = { mode: 'replace', content: this._soul };
    return config;
  }

  /**
   * Lazily (and asynchronously) start the client + session on first use.
   * Reuses an existing client if present. Resumes the saved session id when
   * available, otherwise creates a new session and persists its id.
   */
  async _ensureSession() {
    if (this._session) return this._session;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      if (this._provider) {
        if (!this._provider.model) {
          throw new Error('Custom endpoint (BYOK) requires a model name. Open Settings → GitHub Copilot → Custom model endpoint and set the Model.');
        }
      } else if (!this._token) {
        throw new Error('GitHub Copilot is not logged in. Open Settings → GitHub Copilot → Log in (or enable a custom endpoint).');
      }
      if (!this._client) {
        const client = this._makeClient();
        await client.start();
        this._client = client;
      }
      const client = this._client;
      const cfg = this._sessionConfig();

      let session = null;
      if (this._sessionId) {
        try { session = await client.resumeSession(this._sessionId, cfg); }
        catch { session = null; } // stale/missing session id — fall through to create
      }
      if (!session) {
        session = await client.createSession(cfg);
        this._sessionId = session.sessionId;
        if (this._onSessionId) { try { this._onSessionId(session.sessionId); } catch { /* ignore */ } }
      }
      this._session = session;
      return session;
    })();

    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Stream only assistant reply text for `text`. Reasoning (`assistant.reasoning*`)
   * and tool events (`tool.*`) are ignored. Completion is signalled by `session.idle`.
   */
  _send(text, onChunk, onDone, onError) {
    if (!text) { onError(new Error('No user message to send.')); return; }

    // A new send supersedes any previous stream: drop its subscriptions now so
    // its residual deltas don't leak into this turn.
    if (this._activeCleanup) { try { this._activeCleanup(); } catch { /* ignore */ } this._activeCleanup = null; }

    this._ensureSession().then(async (session) => {
      // If a previous turn was just aborted, wait for the server to settle it
      // before sending — otherwise the runtime may merge the two turns.
      if (this._abortPromise) { try { await this._abortPromise; } catch { /* ignore */ } this._abortPromise = null; }

      let unsub = [];
      let settled = false;
      let streamed = '';
      const cleanup = () => {
        settled = true;
        for (const u of unsub) { try { u(); } catch { /* ignore */ } }
        unsub = [];
        if (this._activeCleanup === cleanup) this._activeCleanup = null;
      };
      this._activeCleanup = cleanup;

      unsub.push(session.on('assistant.message_delta', (e) => {
        if (e && e.agentId) return;                 // ignore sub-agent chatter
        const d = e && e.data && e.data.deltaContent;
        if (d) { streamed += d; onChunk(d); }
      }));
      unsub.push(session.on('session.error', (e) => {
        if (settled) return; cleanup();
        onError(new Error((e && e.data && e.data.message) || 'Copilot session error'));
      }));

      // sendAndWait resolves on `session.idle` with the final assistant message.
      session.sendAndWait(text, SEND_TIMEOUT_MS).then((finalEvt) => {
        if (settled) return;
        const full = finalEvt && finalEvt.data && finalEvt.data.content;
        if (!streamed && full) onChunk(full); // fallback when no deltas were emitted
        cleanup();
        onDone();
      }).catch((err) => {
        if (settled) return; cleanup();
        onError(err instanceof Error ? err : new Error(String(err)));
      });
    }).catch((err) => {
      onError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  /**
   * Reset: delete the current session and start a brand-new one. Used by the
   * "Reset / New session" button in Settings. Returns the new session id.
   */
  async resetSession() {
    const oldId = this._sessionId;
    this._session = null;
    this._initPromise = null;
    if (!this._client && (this._token || this._provider)) {
      try { this._client = this._makeClient(); await this._client.start(); }
      catch { this._client = null; }
    }
    if (this._client && oldId) { try { await this._client.deleteSession(oldId); } catch { /* ignore */ } }
    this._sessionId = null;
    if (this._onSessionId) { try { this._onSessionId(null); } catch { /* ignore */ } }
    if (this._token || this._provider) { await this._ensureSession(); } // create + persist fresh id
    return this._sessionId;
  }

  /** Stop the client without deleting the session (config changed / shutdown). */
  _teardown() {
    const client = this._client;
    this._client = null;
    this._session = null;
    this._initPromise = null;
    if (client) { client.stop().catch(() => {}); }
  }

  /** Graceful shutdown — stop the spawned CLI to avoid orphan processes. */
  async dispose() {
    const client = this._client;
    this._client = null;
    this._session = null;
    this._initPromise = null;
    if (client) { try { await client.stop(); } catch { /* ignore */ } }
  }
}

module.exports = { CopilotLLMService };
