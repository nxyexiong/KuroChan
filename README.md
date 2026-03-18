# KuroChan

A transparent, frameless desktop mascot built with **Electron**, **PixiJS v6**, and **pixi-live2d-display**. KuroChan renders a Live2D character on your desktop and connects it to an LLM (OpenAI), text-to-speech (OpenAI TTS), and local speech-to-text (Whisper) so you can talk to her.

---

## Features

- Transparent, always-on-top frameless window with a draggable Live2D model
- LLM chat via OpenAI (configurable model and system prompt)
- Text-to-speech via OpenAI TTS with lip-sync driven from audio amplitude
- Local speech-to-text via [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (no API key required)
- Voice-activity detection (VAD) with configurable threshold and silence duration
- Persistent conversation memory across sessions
- In-app Settings UI — no config file editing needed

---

## Prerequisites

| Tool | Required for |
|---|---|
| [Node.js 18+](https://nodejs.org/) | Running the app and all npm scripts |
| [Git](https://git-scm.com/) | Initialising the `whisper.cpp` submodule |
| [CMake 3.16+](https://cmake.org/) | Building the Whisper native DLL |
| Visual Studio 2019/2022 (MSVC) | Compiling the Whisper native DLL |

Git, CMake, and MSVC are only needed if you want local speech-to-text. You can skip the Whisper build and run without STT.

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

Free sample models are included in the Cubism SDK under `Samples/Resources/`.

### 5. Build the Whisper native DLL (optional — for local STT)

```powershell
npm run build:whisper
# or directly:
.\scripts\build-whisper.ps1
```

This will:
1. Initialise the `whisper.cpp` git submodule if needed.
2. Configure and build with CMake (Release).
3. Copy `whisper_kuro.dll` to `resources/whisper/`.

Then download a GGML model and place it in `resources/whisper/`:

| File | Size | Notes |
|---|---|---|
| `ggml-base.en.bin` | ~140 MB | English-only, fastest |
| `ggml-base.bin` | ~140 MB | Multilingual |
| `ggml-small.en.bin` | ~460 MB | English-only, more accurate |

Download from <https://huggingface.co/ggerganov/whisper.cpp/tree/main>.

To skip the Whisper build, pass `-SkipWhisper` to the release build script (see below).

### 6. Run in development mode

```bash
npm start        # webpack build + launch Electron
npm run dev      # launch Electron without rebuilding (fast iteration)
```

### 7. Configure via Settings

Click the **⚙** gear icon inside the app to open the Settings panel. From there you can set:

- **Model** — path to the Live2D model folder
- **LLM** — OpenAI API key, model name, and system prompt (character)
- **TTS** — OpenAI TTS API key, model, voice, and speed
- **STT** — Whisper model file path, CPU threads, language, and VAD parameters

Settings are saved to disk and take effect after clicking **Save & Reload**.

---

## Release Build (Windows installer)

`build.ps1` produces a distributable NSIS installer and a portable `.exe` under `release/`.

```powershell
# Full build (whisper DLL + webpack + electron-builder)
.\build.ps1

# Skip whisper DLL (e.g. MSVC not installed)
.\build.ps1 -SkipWhisper

# Force npm install even if node_modules already exists
.\build.ps1 -NpmInstall
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
├── build.ps1                Full release build script
├── scripts/
│   └── build-whisper.ps1    Builds whisper_kuro.dll via CMake
├── src/
│   ├── core.js              App bootstrap — wires all modules together
│   ├── renderer.js          Renderer entry point
│   ├── ui.js                Toolbar and status indicator
│   ├── settings.js          Settings modal
│   ├── model/               Live2D model loading and lip-sync
│   ├── llm/                 LLM abstraction + OpenAI implementation
│   ├── tts/                 TTS abstraction + OpenAI TTS implementation
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
│       ├── whisper_kuro.dll      ← generated by build-whisper.ps1
│       └── ggml-*.bin            ← download separately
└── third_party/
    └── whisper.cpp               ← git submodule
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black background instead of transparent | Ensure `transparent: true` and `backgroundColor: '#00000000'` in `main.js` |
| "Live2D Core missing" | Copy `live2dcubismcore.min.js` into `libs/` |
| Model fails to load | Open Settings and verify the Model folder path |
| STT button does nothing | Build `whisper_kuro.dll` and download a GGML model, then set paths in Settings → STT |
| Whisper DLL build fails | Confirm CMake 3.16+ and MSVC are on `PATH`; run from a VS Developer PowerShell prompt |
| White flash on startup | Expected on some systems; the CSS fade-in on the model canvas mitigates this |
