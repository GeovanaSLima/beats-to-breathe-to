// Signal conditioning (HANDOFF §3): SDK values arrive ~1 Hz, jitter, and change slowly.
// They drive slow macro parameters only, never individual beats.

export const PULSE_MIN = 60;
export const PULSE_MAX = 110;

/** EMA-smoothed, clamped pulse that only reports a new target when it moved ≥ 1 bpm. */
export class PulseTracker {
  private ema: number | null = null;
  target: number | null = null;
  private alpha = 0.3;   // faster than HANDOFF's 0.2 so tempo changes are audible (user's call)
  private deadband = 1;

  /** Feed a raw bpm; returns the new tempo target, or null if it should stay put. */
  push(bpm: number): number | null {
    this.ema = this.ema === null ? bpm : this.ema + this.alpha * (bpm - this.ema);
    const next = Math.min(PULSE_MAX, Math.max(PULSE_MIN, this.ema));
    if (this.target !== null && Math.abs(next - this.target) < this.deadband) return null;
    this.target = next;
    return next;
  }

  reset() { this.ema = this.target = null; }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * "Stable" = breathing within ±tolerance of its rolling median. Stable time accumulates
 * toward `goal` seconds; losing stability decays it slowly instead of hard-resetting.
 */
export class StabilityMeter {
  private window: number[] = [];
  progress = 0; // seconds of steady breathing toward the next unlock
  readonly goal = 20;
  private tolerance = 2;
  private windowSize = 15;
  private minSamples = 5;
  private decayRate = 0.5; // seconds lost per unsteady second

  /** Feed one breathing sample covering `dt` seconds; returns true when an unlock is earned. */
  push(rate: number, dt: number): boolean {
    this.window.push(rate);
    if (this.window.length > this.windowSize) this.window.shift();
    const steady = this.window.length >= this.minSamples && Math.abs(rate - median(this.window)) <= this.tolerance;
    this.progress = steady ? this.progress + dt : Math.max(0, this.progress - dt * this.decayRate);
    if (this.progress < this.goal) return false;
    this.progress = 0;
    return true;
  }

  reset() { this.window = []; this.progress = 0; }
}
