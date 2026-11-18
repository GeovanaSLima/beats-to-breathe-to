import type { Message, SignalSource } from './types.ts';

// Dev-only fake signals (HANDOFF §4.3). The UI must show a SIMULATED badge whenever this is active.
export function createSimulator(): SignalSource {
  let cb: (m: Message) => void = () => {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let pulse = 71, breathing = 11, t = 0;
  // Bounded random walk: drifts, never leaves [lo, hi].
  const walk = (v: number, step: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v + (Math.random() - 0.5) * step));

  return {
    simulated: true,
    onMessage(f) { cb = f; },
    start() {
      if (timer) return;
      t = 0;
      cb({ type: 'status', state: 'camera_on', message: 'simulated' });
      timer = setInterval(() => {
        t++;
        pulse = walk(pulse, 1.6, 66, 76);
        breathing = walk(breathing, 0.8, 9, 13);
        // Mimic the SDK warm-up seen live: pulse locks first, breathing later.
        cb({
          type: 'metrics', ts: Date.now(),
          pulse: t > 3 ? pulse : null,
          breathing: t > 8 ? breathing : null,
          hrv: t > 12 ? 45 + Math.random() * 10 : null,
          faceDetected: true,
          pulseStable: t > 3,
          breathingStable: t > 8,
        });
      }, 1000);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      cb({ type: 'status', state: 'camera_off', message: 'simulated' });
    },
  };
}
