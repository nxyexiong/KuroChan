/**
 * remote-tunnel.js — serves the web app to remote browsers through the
 * kurochan-server tunnel (`GET /app/<path>` → `{t:"http", path}` → this).
 *
 * Only an allowlist is served (the server enforces the same patterns):
 *   ""  | "index.html"                          → index.html with the remote bridge injected
 *   "web-api.js"                                → the browser-side backend bridge
 *   "dist/<name>"                               → the renderer bundle
 *   "third_party/live2d/live2dcubismcore.min.js"→ Live2D Cubism Core
 *   "model/<rel>"                               → files inside the configured model folder
 */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CHUNK_SIZE = 64 * 1024;
const DIST_RE = /^dist\/[A-Za-z0-9._-]+$/;
const CORE_PATH = 'third_party/live2d/live2dcubismcore.min.js';
const CORE_TAG  = '<script src="third_party/live2d/live2dcubismcore.min.js"></script>';
const BRIDGE_TAG = '<script src="web-api.js" data-mode="remote"></script>';

/** Resolve `segs` under `baseDir`; null if the result escapes it. */
function containedPath(baseDir, segs) {
  const base = path.resolve(baseDir);
  const abs  = path.resolve(base, ...segs);
  return abs.startsWith(base + path.sep) ? abs : null;
}

/**
 * @param {{ webRoot:string, webApiPath:string, getModelDir:() => string|null }} opts
 */
function createTunnel({ webRoot, webApiPath, getModelDir }) {
  /** Map a tunnel path to `{ index:true }`, `{ file }`, or null (not allowed). */
  function resolve(reqPath) {
    if (typeof reqPath !== 'string' || reqPath.includes('\0') || reqPath.includes('\\')) return null;
    if (reqPath === '' || reqPath === 'index.html') return { index: true };
    if (reqPath === 'web-api.js') return { file: webApiPath };
    if (reqPath === CORE_PATH) return { file: path.join(webRoot, ...CORE_PATH.split('/')) };
    if (DIST_RE.test(reqPath)) {
      const name = reqPath.slice('dist/'.length);
      return name === '.' || name === '..' ? null : { file: path.join(webRoot, 'dist', name) };
    }
    if (reqPath.startsWith('model/')) {
      const segs = reqPath.slice('model/'.length).split('/');
      if (segs.some((s) => !s || s === '.' || s === '..' || s.includes(':'))) return null;
      const base = getModelDir();
      if (!base) return null;
      const abs = containedPath(base, segs);
      return abs ? { file: abs } : null;
    }
    return null;
  }

  async function buildIndex() {
    const html = await fs.promises.readFile(path.join(webRoot, 'index.html'), 'utf8');
    const injected = html.includes(CORE_TAG)
      ? html.replace(CORE_TAG, `${BRIDGE_TAG}\n  ${CORE_TAG}`)
      : html.replace('</head>', `  ${BRIDGE_TAG}\n</head>`);
    return Buffer.from(injected, 'utf8');
  }

  /**
   * Open a tunnel response.
   * @returns {Promise<{ status:number, etag?:string, size?:number, body?:Buffer, stream?:fs.ReadStream }>}
   */
  async function open(reqPath, ifNoneMatch) {
    const target = resolve(reqPath);
    if (!target) return { status: 404 };

    if (target.index) {
      const body = await buildIndex();
      const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
      if (ifNoneMatch && ifNoneMatch === etag) return { status: 304, etag };
      return { status: 200, etag, size: body.length, body };
    }

    let st;
    try { st = await fs.promises.stat(target.file); } catch { return { status: 404 }; }
    if (!st.isFile()) return { status: 404 };
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (ifNoneMatch && ifNoneMatch === etag) return { status: 304, etag };
    return {
      status: 200,
      etag,
      size: st.size,
      stream: fs.createReadStream(target.file, { highWaterMark: CHUNK_SIZE }),
    };
  }

  return { open, resolve };
}

module.exports = { createTunnel, CHUNK_SIZE };
