const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTunnel } = require('../src/main/remote/remote-tunnel.js');

let root, modelDir, tunnel;

async function readAll(stream) {
  const parts = [];
  for await (const c of stream) parts.push(c);
  return Buffer.concat(parts).toString('utf8');
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kuro-tunnel-'));
  fs.writeFileSync(path.join(root, 'index.html'),
    '<html><head></head><body>\n  <script src="third_party/live2d/live2dcubismcore.min.js"></script>\n</body></html>');
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'bundle');
  fs.mkdirSync(path.join(root, 'third_party', 'live2d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'third_party', 'live2d', 'live2dcubismcore.min.js'), 'core');
  fs.writeFileSync(path.join(root, 'web-api.js'), 'bridge');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
  modelDir = path.join(root, 'models', 'Haru');
  fs.mkdirSync(path.join(modelDir, 'Haru.2048'), { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'Haru.model3.json'), '{}');
  fs.writeFileSync(path.join(modelDir, 'Haru.2048', 'texture_00.png'), 'png');
  tunnel = createTunnel({ webRoot: root, webApiPath: path.join(root, 'web-api.js'), getModelDir: () => modelDir });
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('index.html is served with the remote bridge injected before the Live2D core', async () => {
  const res = await tunnel.open('', undefined);
  assert.equal(res.status, 200);
  const html = res.body.toString('utf8');
  assert.match(html, /<script src="web-api\.js" data-mode="remote"><\/script>\s*<script src="third_party\/live2d/);
  const again = await tunnel.open('index.html', res.etag);
  assert.equal(again.status, 304);
});

test('allowlisted files are streamed and honour If-None-Match', async () => {
  for (const [p, body] of [
    ['dist/bundle.js', 'bundle'],
    ['web-api.js', 'bridge'],
    ['third_party/live2d/live2dcubismcore.min.js', 'core'],
    ['model/Haru.model3.json', '{}'],
    ['model/Haru.2048/texture_00.png', 'png'],
  ]) {
    const res = await tunnel.open(p);
    assert.equal(res.status, 200, p);
    assert.equal(await readAll(res.stream), body);
    const cached = await tunnel.open(p, res.etag);
    assert.equal(cached.status, 304, p);
  }
});

test('anything outside the allowlist or escaping the model folder is rejected', async () => {
  for (const p of [
    'secret.txt', 'src/main/index.js', '../secret.txt', 'dist/../secret.txt', 'dist/sub/bundle.js', 'dist/..', 'dist/.',
    'model/../../../secret.txt', 'model/Haru.2048/../../../secret.txt', 'model/..', 'model/',
    'model//x', 'model/C:/x', 'model\\..\\secret.txt', 'model/a\0b', 'third_party/live2d/other.js',
  ]) {
    const res = await tunnel.open(p);
    assert.equal(res.status, 404, p);
  }
});

test('model paths 404 when no model is configured', async () => {
  const t = createTunnel({ webRoot: root, webApiPath: path.join(root, 'web-api.js'), getModelDir: () => null });
  assert.equal((await t.open('model/Haru.model3.json')).status, 404);
});
