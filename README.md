# Live2D Transparent Desktop Viewer

A transparent, frameless desktop window to display Live2D models, built with **Electron**, **PixiJS v6**, and **pixi-live2d-display**.

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Add the Live2D Cubism Core (required — proprietary)

1. Download the **Cubism SDK for Web** from:  
   <https://www.live2d.com/sdk/download/web/>
2. Extract the archive.
3. Copy `Core/live2dcubismcore.min.js` into the **`libs/`** folder.

> The Core is proprietary and not distributed via npm.

### 3. Add a Live2D model

Place your model folder inside **`assets/models/`**.  
The model must contain a `.model3.json` file (Cubism 4) or `.model.json` (Cubism 2).

**Example structure:**
```
assets/
  models/
    Haru/
      Haru.model3.json
      Haru.moc3
      textures/
        ...
```

Free sample models ship with the Cubism SDK under `Samples/Resources/`.

### 4. Set your model path

Edit `src/renderer.js` and update the constant at the top:

```js
const MODEL_PATH = 'assets/models/Haru/Haru.model3.json';
```

### 5. Build & run

```bash
npm start
```

This compiles the renderer bundle with webpack, then launches Electron.

---

## Usage

| Action | How |
|---|---|
| Move model inside window | Click-drag the character |
| Move the window | Click-drag the **⠿⠿** toolbar button |
| Close | Click the **✕** button |

---

## Project Structure

```
testlive2d/
├── main.js            Electron main process (window creation)
├── preload.js         Contextbridge (IPC to main)
├── index.html         App shell (loads core + bundle)
├── webpack.config.js  Bundles src/renderer.js -> dist/bundle.js
├── src/
│   └── renderer.js    PixiJS + Live2D rendering logic
├── libs/
│   └── live2dcubismcore.min.js   ← YOU add this
└── assets/
    └── models/        ← YOU add model folders here
```

---

## Platform notes

- **Windows 10 / 11** — transparent windows work out of the box.
- **macOS** — works; `alwaysOnTop` respects the active Space.
- **Linux** — requires a compositor (e.g. Picom, KWin, Mutter).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Black background instead of transparent | Ensure `transparent: true` and `backgroundColor: '#00000000'` in `main.js` |
| "Live2D Core missing" message | Add `libs/live2dcubismcore.min.js` |
| Model fails to load | Check `MODEL_PATH` in `src/renderer.js`; open DevTools (uncomment in `main.js`) |
| White flash on startup | Expected on some systems; add a short CSS fade-in |
