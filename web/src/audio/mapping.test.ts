import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breathingToTone, hrvToSwing } from './mapping.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('breathing: slow is open, fast is muffled, clamped outside 10–18', () => {
  assert.deepEqual(breathingToTone(10), { cutoff: 8000, wet: 0.45 });
  near(breathingToTone(18).cutoff, 1200); near(breathingToTone(18).wet, 0.15);
  assert.deepEqual(breathingToTone(6), breathingToTone(10));
  assert.deepEqual(breathingToTone(30), breathingToTone(18));
  near(breathingToTone(14).cutoff, Math.sqrt(8000 * 1200));
});

test('hrv: maps 20–80 ms to 0–0.15 swing', () => {
  assert.equal(hrvToSwing(10), 0);
  near(hrvToSwing(50), 0.075);
  assert.equal(hrvToSwing(200), 0.15);
});
