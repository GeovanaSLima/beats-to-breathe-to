import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PulseTracker, StabilityMeter } from './smoothing.ts';

test('pulse: first value sets target, small moves are ignored, clamped to 60–110', () => {
  const p = new PulseTracker();
  assert.equal(p.push(72), 72);
  assert.equal(p.push(73), null, 'EMA moves 0.3 bpm: below the 1 bpm deadband');
  for (let i = 0; i < 30; i++) p.push(140);
  assert.equal(p.target, 110);
  const low = new PulseTracker();
  assert.equal(low.push(40), 60);
});

test('pulse: one outlier barely moves the tempo', () => {
  const p = new PulseTracker();
  p.push(88);
  assert.ok(Math.abs(p.push(100)! - 91.6) < 1e-9, 'EMA α 0.3 → 88 + 0.3 × 12');
});

test('stability: 20 steady seconds unlock, then the counter resets', () => {
  const s = new StabilityMeter();
  let unlocks = 0;
  for (let i = 0; i < 24; i++) if (s.push(11 + (i % 2) * 0.5, 1)) unlocks++;
  // first 4 samples fill the window (minSamples 5), then 20 steady seconds
  assert.equal(unlocks, 1);
  assert.equal(s.progress, 0);
});

test('stability: an outlier decays progress slowly instead of resetting', () => {
  const s = new StabilityMeter();
  for (let i = 0; i < 14; i++) s.push(11, 1); // 10 s of progress
  assert.equal(s.progress, 10);
  s.push(21.4, 1);
  assert.equal(s.progress, 9.5);
  s.push(11, 1);
  assert.equal(s.progress, 10.5);
});
