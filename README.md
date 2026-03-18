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
3. Copy `Core/live2dcubismcore.min.js` into the **`libs/`** folder.

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
├── main.js                  Electron main process (window, IPC, config)
├── preload.js               Context bridge — exposes electronAPI to renderer
├── index.html               App shell
├── webpack.config.js        Bundles src/ → dist/bundle.js
├── build.cmd                Full release build script
├── scripts/
│   └── build-whisper.cmd    Builds whisper_kuro.dll via CMake
├── src/
│   ├── core.js              App bootstrap — wires all modules together
│   ├── renderer.js          Renderer entry point
│   ├── ui.js                Toolbar and status indicator
│   ├── settings.js          Settings modal
│   ├── model/               Live2D model loading, drag, and zoom
│   ├── llm/                 LLM abstraction + provider implementations
│   ├── tts/                 TTS abstraction + provider implementation
│   ├── stt/                 STT abstraction + Whisper local implementation
│   ├── chat/                Chat logic and built-in service
│   └── styles/
│       └── main.css
├── libs/
│   └── live2dcubismcore.min.js   ← add this (proprietary)
├── assets/
│   └── models/                   ← add model folders here
├── resources/
│   └── whisper/
│       ├── whisper_kuro.dll      ← generated by build-whisper.cmd
│       └── *.bin                 ← Whisper model file (download separately)
└── third_party/
    ├── whisper.cpp               Whisper C++ source
    └── whisper_wrapper.cpp       Native DLL wrapper
```
