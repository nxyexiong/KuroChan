# KuroChan

A transparent, frameless desktop mascot built with **Electron**, **PixiJS v6**, and **pixi-live2d-display**. KuroChan renders a Live2D character on your desktop and connects it to **GitHub Copilot**, text-to-speech, and local speech-to-text so you can talk to her.

---

## Features

- Transparent, always-on-top frameless window with a draggable, zoomable Live2D model
- LLM chat powered by **GitHub Copilot** (via [@github/copilot-sdk](https://github.com/github/copilot-sdk)) — a persistent conversation that resumes across launches, with a configurable character (system prompt). Optionally **bring your own key (BYOK)** to use any OpenAI-compatible, Azure OpenAI, or Anthropic endpoint (including local models like Ollama) instead of a GitHub login
- Text-to-speech with **local streaming** via [Kokoro-82M](https://github.com/hexgrad/kokoro) (default, no cloud key) plus cloud providers (OpenAI TTS, xAI TTS), with lip-sync driven from audio amplitude and adjustable pitch
- Local speech-to-text via [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (no cloud API required)
- Voice-activity detection (VAD) with configurable threshold and silence duration
- In-app Settings UI — no config file editing needed

---

## Prerequisites

| Tool | Required for |
|---|---|
| [Node.js 18+](https://nodejs.org/) | Running the app and all npm scripts |
| [CMake 3.16+](https://cmake.org/) | Building the Whisper native DLL |
| Visual Studio 2019/2022 (MSVC) | Compiling the Whisper native DLL |

CMake and MSVC are only needed if you want local speech-to-text. You can skip the Whisper build and run without STT.

---

## Get Started

### 1. Clone the repository

```bash
git clone <repo-url> KuroChan
cd KuroChan
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Add the Live2D Cubism Core (required — proprietary)

1. Download the **Cubism SDK for Web** from <https://www.live2d.com/sdk/download/web/>
2. Extract the archive.
3. Copy `Core/live2dcubismcore.min.js` into **`third_party/live2d/`**.

> The Core is proprietary and cannot be distributed via npm.

### 4. Add a Live2D model

Place your model folder inside `resources/models/`. The folder must contain a `.model3.json` file (Cubism 4).

```
resources/
  models/
    Haru/
      Haru.model3.json
      Haru.moc3
      ...
```

The default model path is `resources/models/Haru`. Free sample models are available in the Cubism SDK under `Samples/Resources/`.

### 5. Build the Whisper native DLL (optional — for local STT)

```bat
npm run build:whisper
```

This will:
1. Configure and build whisper.cpp with CMake (Release).
2. Copy `whisper_kuro.dll` to `resources/whisper/`.

Then download a Whisper model file and place it in `resources/whisper/`. Models are available from the [whisper.cpp Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main).

### 6. Run in development mode

```bash
npm start        # webpack build + launch Electron
npm run dev      # launch Electron without rebuilding (fast iteration)
```

### 7. Configure via Settings

Click the **⚙** gear icon inside the app to open the Settings panel. From there you can set:

- **Model** — path to the Live2D model folder
- **LLM** — **GitHub Copilot** is the LLM backend. Set the character (system prompt), then use the device-flow **Log in** button (shows a code to enter at <https://github.com/login/device>), the model / thinking-effort / context-length selectors loaded asynchronously from your Copilot account, and a **Reset / New session** button. Copilot keeps one persistent conversation across launches; its CLI data lives in `~/.kurochan/.copilot` and its workspace in `~/.kurochan/workspace`. Requires a GitHub Copilot subscription. Alternatively, toggle **Use a custom model endpoint (BYOK)** at the top of the section to switch from the GitHub login to your own OpenAI-compatible, Azure OpenAI, or Anthropic endpoint (set the provider type, endpoint URL, optional API key, and model name; optionally a thinking-effort level, context length / max prompt tokens, and max output tokens for models whose limits the runtime can't infer). When BYOK is enabled, inference goes to your endpoint and a GitHub login is **not** required — handy for local models (e.g. Ollama at `http://localhost:11434/v1`).
- **TTS** — service selector (**Kokoro (local)** / OpenAI TTS / xAI TTS), pitch adjustment (−12 to +12 semitones), and per-provider config. **Kokoro** is the default and runs 100% locally (streaming, 24 kHz): set the **model folder**, precision (dtype), voice, and speed. Like Whisper, you supply the model yourself — download it from [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) (the folder must contain `config.json`, `tokenizer.json`, and an `onnx/model_*.onnx` matching the chosen precision; the 54 voice files ship with the app).
- **STT** — Whisper model file path, CPU threads, language, and VAD parameters (voice threshold, silence duration)

Settings are saved to disk and take effect after clicking **Save & Reload**.

---

## Release Build (Windows installer)

`build.cmd` produces a distributable NSIS installer under `release/`.

```bat
:: Full build (whisper DLL + webpack + electron-builder)
build.cmd

:: Skip whisper DLL (e.g. MSVC not installed)
build.cmd /skipwhisper

:: Force npm install even if node_modules already exists
build.cmd /npminstall
```

Alternatively, use npm directly:

```bash
npm run dist
```

---

## npm scripts reference

| Script | Description |
|---|---|
| `npm start` | webpack (dev) + launch Electron |
| `npm run dev` | Launch Electron without rebuilding |
| `npm run build:js` | webpack bundle only |
| `npm run build:whisper` | Build `whisper_kuro.dll` native addon |
| `npm run dist` | Production webpack + electron-builder (Windows) |
| `npm run debug` | Launch with Node inspector and remote DevTools |

---

## Project Structure

```
KuroChan/
├── index.html                        App shell (loads Live2D Core + renderer bundle)
├── webpack.config.js                 Bundles src/renderer/ → dist/bundle.js
├── build.cmd                         Full release build script
├── package.json
│
├── src/
│   ├── main/                         ── Electron main process (Node.js, CommonJS) ──
│   │   ├── index.js                  Entry point — window creation, IPC handlers, service wiring
│   │   ├── preload.js                Context bridge — exposes window.electronAPI to renderer
│   │   │
│   │   ├── chat/                     Chat module (facade → base → builtin)
│   │   │   ├── chat.js               Facade — selects service, exposes configureChat / handleBuiltinChatMessage
│   │   │   ├── chat-service.js       Base class — shared chat pipeline (validate, stop TTS, send to LLM)
│   │   │   └── builtin-chat-service.js  Specialization — renderer chat box entry point
│   │   │
│   │   ├── llm/                      LLM module (GitHub Copilot only)
│   │   │   ├── llm.js                Facade — owns the single output stream, delegates to the Copilot service
│   │   │   ├── copilot-llm-service.js    GitHub Copilot SDK backend (persistent session, reply-only stream)
│   │   │   ├── copilot-auth.js           GitHub device-flow login + ~/.kurochan paths + model listing
│   │   │   └── copilot-cli-shim.cjs      Electron preload that fixes the spawned CLI's argv parsing
│   │   │
│   │   ├── tts/                      TTS module (facade → base → kokoro / openai / xai)
│   │   │   ├── tts.js                Facade — selects service, delegates speak / stop / volume
│   │   │   ├── tts-service.js        Base class — window, IPC _send, stream lifecycle, pitch, lip sync
│   │   │   ├── kokoro-tts-service.js Specialization — local Kokoro-82M streaming TTS (24 kHz PCM, default)
│   │   │   ├── kokoro-worker.js      Worker thread that runs Kokoro synthesis off the main thread
│   │   │   ├── openai-tts-service.js Specialization — OpenAI TTS (streaming AAC)
│   │   │   └── xai-tts-service.js    Specialization — xAI TTS
│   │   │
│   │   ├── stt/                      STT module (facade → base → whisper)
│   │   │   ├── stt.js                Facade — selects service, delegates start / stop / audio
│   │   │   ├── stt-service.js        Base class — window, VAD state machine, resampling, audio pipeline
│   │   │   └── whisper-stt-service.js  Specialization — whisper.cpp native transcription
│   │   │
│   │   └── model/                    Model module (facade → base → builtin)
│   │       ├── model.js              Facade — selects service, delegates setMouthOpen
│   │       ├── model-service.js      Base class — abstract setMouthOpen()
│   │       └── builtin-model-service.js  Specialization — Electron IPC model control
│   │
│   ├── renderer/                     ── Renderer process (ES modules, webpack bundled) ──
│   │   ├── index.js                  Entry point — config, settings, bootstrap, UI wiring
│   │   ├── status.js                 Status bar helpers
│   │   ├── settings.js               Settings modal (pure DOM)
│   │   ├── chat/
│   │   │   └── chat.js               Chat UI — textarea + streamed output display
│   │   ├── tts/
│   │   │   └── tts-player.js         Audio playback (AudioContext) + RMS volume → lip sync
│   │   ├── stt/
│   │   │   └── stt-ui.js             Mic button + AudioWorklet capture → sends PCM to main
│   │   ├── model/
│   │   │   └── model.js              PixiJS + Live2D rendering, drag, zoom, applies IPC params
│   │   └── styles/
│   │       └── main.css
│   │
│   └── shared/
│       └── ipc-channels.js           IPC channel name constants (protocol documentation)
│
├── scripts/
│   └── build-whisper.cmd             Builds whisper_kuro.dll via CMake
├── resources/
│   ├── models/                       ← add Live2D model folders here
│   └── whisper/                      ← Whisper DLL and model files
├── resources/
│   └── whisper/
│       └── whisper_kuro.dll          ← generated by build-whisper.cmd
└── third_party/
    ├── live2d/
    │   └── live2dcubismcore.min.js   ← add this (proprietary, see setup step 3)
    ├── whisper.cpp/                  Whisper C++ source (git submodule)
    └── whisper_wrapper.cpp           Native DLL wrapper
```

### Architecture

KuroChan follows a strict **main/renderer process separation**:

- **Main process** (`src/main/`) — All business logic, remote API calls, and service orchestration run here. The renderer never calls external APIs directly.
- **Renderer process** (`src/renderer/`) — Pure UI layer. Handles DOM manipulation, PixiJS/Live2D rendering, audio playback, and mic capture. Communicates with main exclusively through `window.electronAPI` (IPC).
- **Shared** (`src/shared/`) — IPC channel name constants that document the protocol between main and renderer.

#### Design Pattern — Facade → Base Class → Specialization

Every main-process module follows a three-layer pattern:

```
┌──────────────────────────────────┐
│  Facade  ({module}.js)           │  Thin entry point, selects the active service,
│                                  │  exposes the module's public API.
├──────────────────────────────────┤
│  Base class  ({module}-service.js)│  Owns all shared logic: state, lifecycle,
│                                  │  IPC helpers. Calls _configure() hook.
├──────────────────────────────────┤
│  Specialization                  │  Implements only provider/transport-specific
│  (e.g. openai-tts-service.js)   │  behaviour. Overrides _configure() + abstracts.
└──────────────────────────────────┘
```

| Layer | Responsibility | Example (TTS) |
|---|---|---|
| **Facade** | Service selection, public function exports | `tts.js` — `configureTTS`, `speak`, `stopTTS` |
| **Base class** | Shared state & logic (`_win`, `_send()`, lifecycle) | `tts-service.js` — stream events, pitch, lip sync |
| **Specialization** | Provider-specific config & streaming | `openai-tts-service.js` — `_configure()`, `streamAudio()`, `abort()` |

**Key conventions:**

- `configure(config)` on the base class handles shared setup, then delegates to `_configure(config)` (underscore-prefixed) on the specialization.
- Abstract methods that a specialization **must** implement are documented in the base class (e.g. `stream()`, `transcribe()`, `streamAudio()`).
- The facade never holds business logic — it only maps public function calls to `service.*` methods.
- During startup, `configureAllServices()` runs **before** `initServices()` because configure creates new service instances, which would wipe any window refs set earlier.

#### Data Flows

- **Chat**: renderer sends user text via `chat:builtin-send` → `BuiltinChatService.handleBuiltinChatMessage()` → base `handleUserMessage()` validates input, stops any playing TTS, and forwards to LLM `input()`
- **LLM**: accepts input from multiple sources (chat UI, STT) and forwards it to the single GitHub Copilot service, which keeps a persistent server-side session (one conversation across launches) and streams back only the assistant's reply text — reasoning and tool activity are suppressed
- **TTS**: base class receives `speak(text)`, wires stream events to IPC (`tts:audio-chunk`, `tts:audio-end`), and drives lip sync from volume reports; specialization streams audio from the provider
- **STT**: base class owns the full VAD pipeline (silence detection, RMS, resampling, chunk buffering); specialization only implements `transcribe(samplesBuffer)` — transcript is fed directly to LLM
- **Model**: receives `setMouthOpen(value)` calls from TTS → builtin specialization sends `model:set-parameter` IPC to renderer → renderer applies to Live2D coreModel
