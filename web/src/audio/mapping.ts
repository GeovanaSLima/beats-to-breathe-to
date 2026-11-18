// Signal → sound mapping (HANDOFF §3). Pure functions so they can be tested without audio.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Slow breathing (≤10/min) opens the sound; fast (≥18/min) muffles it. */
export function breathingToTone(rate: number) {
  const t = clamp01((rate - 10) / (18 - 10));
  return {
    cutoff: 8000 * Math.pow(1200 / 8000, t), // log interpolation: equal steps sound equal
    wet: 0.45 + (0.15 - 0.45) * t,
  };
}

/** More heart-rate variability → a little more swing (0–0.15). RMSSD ~20–80 ms covers most people. */
export function hrvToSwing(rmssd: number) {
  return 0.15 * clamp01((rmssd - 20) / (80 - 20));
}
