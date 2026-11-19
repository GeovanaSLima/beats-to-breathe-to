import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from './wav.ts';

test('wav: header describes 16-bit stereo PCM and the data follows it', async () => {
  const pcm = new Int16Array([1, -1, 32767, -32767]); // two stereo frames
  const buf = new DataView(await encodeWav([pcm], 48000).arrayBuffer());
  const text = (at: number) => String.fromCharCode(...new Uint8Array(buf.buffer, at, 4));
  assert.equal(text(0), 'RIFF');
  assert.equal(text(8), 'WAVE');
  assert.equal(buf.getUint32(4, true), 36 + 8);
  assert.equal(buf.getUint16(22, true), 2, 'stereo');
  assert.equal(buf.getUint32(24, true), 48000);
  assert.equal(buf.getUint16(34, true), 16, '16-bit');
  assert.equal(buf.getUint32(40, true), 8, 'data size in bytes');
  assert.equal(buf.getInt16(44 + 4, true), 32767);
  assert.equal(buf.byteLength, 44 + 8);
});
