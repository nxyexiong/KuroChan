const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeBinary, decodeBinary, KIND } = require('../src/main/remote/remote-codec.js');

test('binary frames round-trip kind, id and payload (incl. typed-array views)', () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const view = backing.subarray(2, 5);
  const frame = decodeBinary(encodeBinary(KIND.TTS_AUDIO, 'client-1', view));
  assert.equal(frame.kind, KIND.TTS_AUDIO);
  assert.equal(frame.id, 'client-1');
  assert.deepEqual([...frame.payload], [1, 2, 3]);

  const empty = decodeBinary(encodeBinary(KIND.TUNNEL_BODY, '', Buffer.alloc(0)));
  assert.equal(empty.id, '');
  assert.equal(empty.payload.length, 0);
});

test('malformed frames decode to null', () => {
  assert.equal(decodeBinary(Buffer.from([1])), null);
  assert.equal(decodeBinary(Buffer.from([1, 5, 65])), null);
});
