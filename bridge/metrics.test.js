import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, toMessage } from './metrics.js';

test('collect keeps the newest sample per signal across packets', () => {
  const s = {};
  collect({ cardio: { pulseRate: [{ value: 70 }, { value: 71 }], hrv: [] }, breathing: { rate: [] } }, s);
  collect({ cardio: { pulseRate: [] }, breathing: { rate: [{ value: 12 }] } }, s);
  assert.equal(s.pulse.value, 71, 'later packet without pulse keeps it');
  assert.equal(s.breathing.value, 12);
  assert.equal(s.hrv, undefined);
});

test('fields stay null until the first stable sample', () => {
  const m = toMessage({ pulse: { value: 80, stable: false }, breathing: { value: 12, stable: false } }, null, true, 1);
  assert.deepEqual(m, { type: 'metrics', ts: 1, pulse: null, breathing: null, hrv: null, faceDetected: true, pulseStable: false, breathingStable: false });
});

test('stable sample sets values, later unstable samples still update', () => {
  const a = toMessage({ pulse: { value: 72.4, stable: true }, breathing: { value: 11.2, stable: true }, hrv: { rmssd: 48, stable: true } }, null, true, 1);
  assert.equal(a.pulse, 72.4); assert.equal(a.breathing, 11.2); assert.equal(a.hrv, 48); assert.equal(a.pulseStable, true);
  const b = toMessage({ pulse: { value: 75, stable: false } }, a, true, 2);
  assert.equal(b.pulse, 75); assert.equal(b.pulseStable, false);
  assert.equal(b.breathing, 11.2, 'missing sample keeps the previous value'); assert.equal(b.breathingStable, true);
});

test('no samples keeps the previous message values', () => {
  const a = toMessage({ pulse: { value: 70, stable: true } }, null, true, 1);
  const b = toMessage({}, a, false, 2);
  assert.equal(b.pulse, 70); assert.equal(b.faceDetected, false);
});
