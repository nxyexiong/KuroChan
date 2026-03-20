# KuroChan

A transparent, frameless desktop mascot built with **Electron**, **PixiJS v6**, and **pixi-live2d-display**. KuroChan renders a Live2D character on your desktop and connects it to a language model, text-to-speech, and local speech-to-text so you can talk to her.

---

## Features

- Transparent, always-on-top frameless window with a draggable, zoomable Live2D model
- LLM chat with configurable provider, model, and system prompt (character personality)
- Text-to-speech with lip-sync driven from audio amplitude and adjustable pitch
- Local speech-to-text via [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (no cloud API required)
- Voice-activity detection (VAD) with configurable threshold and silence duration
- Persistent conversation memory across sessions
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

Place your model folder inside `assets/models/`. The folder must contain a `.model3.json` file (Cubism 4).

```
assets/
  models/
    Haru/
      Haru.model3.json
      Haru.moc3
      ...
```

Free sample models are available in the Cubism SDK under `Samples/Resources/`.

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

- **Model** — path to the Live2D model folder and display scale
- **LLM** — provider URL, API key, model name, and system prompt (character)
- **TTS** — provider URL, API key, voice, speed, and pitch adjustment
- **STT** — Whisper model file path, CPU threads, language, and VAD parameters

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
├── index.html                      App shell (loads Live2D Core + renderer bundle)
├── webpack.config.js               Bundles src/renderer/ → dist/bundle.js
├── build.cmd                       Full release build script
├── package.json
│
├── src/
│   ├── main/                       ── Electron main process (Node.js, CommonJS) ──
│   │   ├── index.js                Entry point — window creation, IPC handlers, service wiring
│   │   ├── preload.js              Context bridge — exposes window.electronAPI to renderer
│   │   ├── chat/
│   │   │   └── chat-service.js     Chat orchestrator — routes user input → LLM → TTS
│   │   ├── llm/
│   │   │   ├── llm.js              LLM facade (callback-based streaming API)
│   │   │   ├── llm-service.js      Abstract LLM base class
│   │   │   ├── openai-llm-service.js       OpenAI Chat Completions (streaming SSE)
│   │   │   ├── openclaw-llm-service.js     OpenClaw WebSocket gateway (ws package)
│   │   │   └── openclaw-device-identity.js Ed25519 device identity (Node crypto)
│   │   ├── tts/
│   │   │   ├── tts.js              TTS facade — fetches MP3, sends base64 to renderer
│   │   │   └── openai-tts-service.js       OpenAI TTS (returns Buffer, no playback)
│   │   ├── stt/
│   │   │   └── stt.js              VAD + whisper transcription (receives PCM from renderer)
│   │   └── model/
│   │       └── model.js            Lip-sync control — sends model parameters via IPC
│   │
│   ├── renderer/                   ── Renderer process (ES modules, webpack bundled) ──
│   │   ├── index.js                Entry point — close button, settings, bootstrap
│   │   ├── core.js                 Loads config, initialises UI modules
│   │   ├── ui.js                   Status bar helpers
│   │   ├── settings.js             Settings modal (pure DOM)
│   │   ├── chat/
│   │   │   └── chat.js             Chat UI — textarea + streamed output display
│   │   ├── tts/
│   │   │   └── tts-player.js       Audio playback (AudioContext) + RMS volume → lip sync
│   │   ├── stt/
│   │   │   └── stt-ui.js           Mic button + AudioWorklet capture → sends PCM to main
│   │   ├── model/
│   │   │   └── model.js            PixiJS + Live2D rendering, drag, zoom, applies IPC params
│   │   └── styles/
│   │       └── main.css
│   │
│   └── shared/
│       └── ipc-channels.js         IPC channel name constants (protocol documentation)
│
├── scripts/
│   └── build-whisper.cmd           Builds whisper_kuro.dll via CMake
├── assets/
│   └── models/                     ← add Live2D model folders here
├── resources/
│   └── whisper/
│       └── whisper_kuro.dll        ← generated by build-whisper.cmd
└── third_party/
    ├── live2d/
    │   └── live2dcubismcore.min.js ← add this (proprietary, see setup step 3)
    ├── whisper.cpp/                Whisper C++ source (git submodule)
    └── whisper_wrapper.cpp         Native DLL wrapper
```

### Architecture

KuroChan follows a strict **main/renderer process separation**:

- **Main process** (`src/main/`) — All business logic, remote API calls, and service orchestration run here. The renderer never calls external APIs directly.
- **Renderer process** (`src/renderer/`) — Pure UI layer. Handles DOM manipulation, PixiJS/Live2D rendering, audio playback, and mic capture. Communicates with main exclusively through `window.electronAPI` (IPC).
- **Shared** (`src/shared/`) — IPC channel name constants that document the protocol between main and renderer.

Data flows:
- **Chat**: renderer sends user text → main's chat service forwards to LLM
- **LLM**: accepts input from multiple sources (chat UI, STT); maintains one output stream that streams reply chunks to renderer for display and triggers TTS on completion
- **TTS**: main fetches MP3 audio → sends base64 to renderer → renderer decodes, plays via AudioContext, and reports real-time volume back to main → TTS forwards volume to model service for lip sync
- **STT**: renderer captures mic (AudioWorklet) → sends PCM chunks to main → main does VAD + whisper transcription → feeds transcript directly to LLM
- **Model**: receives lip sync parameters from TTS (via model service in main) → sends `model:set-parameter` IPC to renderer → renderer applies to Live2D coreModel
