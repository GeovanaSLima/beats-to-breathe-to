import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMessage } from './metrics.js';

const pkt = (pulse, breathing, hrv) => ({
  cardio: { pulseRate: pulse ? [pulse] : [], hrv: hrv ? [hrv] : [] },
  breathing: { rate: breathing ? [breathing] : [] },
});

test('fields stay null until the first stable sample', () => {
  const m = toMessage(pkt({ value: 80, stable: false }, { value: 12, stable: false }), null, true, 1);
  assert.deepEqual(m, { type: 'metrics', ts: 1, pulse: null, breathing: null, hrv: null, faceDetected: true, pulseStable: false, breathingStable: false });
});

test('stable sample sets values, later unstable samples still update', () => {
  const a = toMessage(pkt({ value: 72.4, stable: true }, { value: 11.2, stable: true }, { rmssd: 48, stable: true }), null, true, 1);
  assert.equal(a.pulse, 72.4); assert.equal(a.breathing, 11.2); assert.equal(a.hrv, 48); assert.equal(a.pulseStable, true);
  const b = toMessage(pkt({ value: 75, stable: false }), a, true, 2);
  assert.equal(b.pulse, 75); assert.equal(b.pulseStable, false);
  assert.equal(b.breathing, 11.2, 'missing series keeps the previous value'); assert.equal(b.breathingStable, true);
});

test('empty packet keeps the previous message values', () => {
  const a = toMessage(pkt({ value: 70, stable: true }), null, true, 1);
  const b = toMessage({}, a, false, 2);
  assert.equal(b.pulse, 70); assert.equal(b.faceDetected, false);
});
