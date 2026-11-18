// App state machine (HANDOFF §4.5) and the signal → audio loop. No DOM here; main.ts renders `state`.
//   welcome → tuning → playing → tape → playing (play again) | welcome (back)
//   "Turn off" from tuning/playing → welcome.
import { createSignalSource } from './signals/source.ts';
import type { Message, Metrics } from './signals/types.ts';
import { PulseTracker, StabilityMeter } from './signals/smoothing.ts';
import { createEngine, LAYERS, type Layer } from './audio/engine.ts';
import { hrvToSwing } from './audio/mapping.ts';

export type Screen = 'welcome' | 'tuning' | 'playing' | 'tape';

const AWAY_AFTER_MS = 5000;   // no face this long while playing → hold tempo, dim the radio
const AUTO_START_MS = 1500;   // tuning → playing once all three checks pass

export function createSession(onChange: () => void, onUnlock: (layer: Layer) => void) {
  const source = createSignalSource();
  const engine = createEngine();
  const pulse = new PulseTracker();
  const steady = new StabilityMeter();

  const state = {
    screen: 'welcome' as Screen,
    simulated: source.simulated,
    error: '',
    metrics: null as Metrics | null,
    faceDetected: false,
    tempo: null as number | null,   // smoothed pulse = station frequency
    steadySeconds: 0,
    unlocked: [] as Layer[],
    away: false,
    stats: { bpmSum: 0, bpmCount: 0, breathSum: 0, breathCount: 0 },
  };

  let noFaceSince: number | null = null;
  let autoStart: ReturnType<typeof setTimeout> | undefined;
  // Audio start/stop take time (fades); queue them so a quick "play again" can't be cut by a pending stop.
  let audioQueue = Promise.resolve();
  const audio = (fn: () => Promise<void>) => (audioQueue = audioQueue.then(fn).catch((e) => console.error(e)));

  const ready = () =>
    !!state.metrics && state.faceDetected && state.metrics.pulseStable && state.metrics.breathingStable && state.tempo !== null;

  function setFace(present: boolean) {
    state.faceDetected = present;
    if (present) noFaceSince = null;
    else noFaceSince ??= Date.now();
  }

  function onMetrics(m: Metrics) {
    state.metrics = m;
    setFace(m.faceDetected);
    // Without a face the bridge repeats stale values: hold the tempo and pause tape progress.
    if (!m.faceDetected) return;

    if (m.pulse !== null) {
      const target = pulse.push(m.pulse);
      if (target !== null) {
        state.tempo = target;
        if (state.screen === 'playing') engine.setTempo(target);
      }
    }
    if (m.breathing !== null) engine.setBreathing(m.breathing);
    if (m.hrv !== null) engine.setSwing(hrvToSwing(m.hrv));

    if (state.screen !== 'playing') return;
    if (m.pulse !== null) { state.stats.bpmSum += m.pulse; state.stats.bpmCount++; }
    if (m.breathing !== null) {
      state.stats.breathSum += m.breathing;
      state.stats.breathCount++;
      if (state.unlocked.length < LAYERS.length && steady.push(m.breathing, 1)) unlockNext();
      state.steadySeconds = steady.progress;
    }
  }

  function unlockNext() {
    const layer = engine.unlockNext();
    if (!layer) return;
    engine.chime();
    state.unlocked = engine.unlocked;
    onUnlock(layer);
  }

  source.onMessage((msg: Message) => {
    if (msg.type === 'status') {
      // Keep an error visible through the camera_off that follows it; clear it once the camera is back.
      if (msg.state === 'error') state.error = msg.message;
      else if (msg.state === 'camera_on') state.error = '';
      // camera_on doesn't mean a face was found; face presence comes from metrics.faceDetected.
      if (msg.state === 'no_face' || msg.state === 'error') setFace(false);
    } else {
      onMetrics(msg);
    }
    if (state.screen === 'tuning' && ready() && autoStart === undefined) {
      autoStart = setTimeout(() => {
        if (state.screen === 'tuning' && ready()) startPlaying();
        else autoStart = undefined; // lost the lock during the wait; re-arm on the next ready message
      }, AUTO_START_MS);
    }
    onChange();
  });

  // Re-check "away" every second: messages may stop entirely if the bridge goes quiet.
  setInterval(() => {
    const away = state.screen === 'playing' && noFaceSince !== null && Date.now() - noFaceSince > AWAY_AFTER_MS;
    if (away !== state.away) { state.away = away; onChange(); }
  }, 1000);

  function go(screen: Screen) {
    state.screen = screen;
    clearTimeout(autoStart);
    autoStart = undefined;
    onChange();
  }

  function resetRun() {
    steady.reset();
    state.steadySeconds = 0;
    state.unlocked = [];
    state.away = false;
    state.stats = { bpmSum: 0, bpmCount: 0, breathSum: 0, breathCount: 0 };
  }

  function stopEverything() {
    source.stop();
    audio(() => engine.stop());
  }

  function startPlaying() {
    resetRun();
    audio(() => engine.start(state.tempo ?? 72)); // read tempo when the queued start runs, not now
    go('playing');
  }

  /** Forget the previous camera session's readings (tempo is kept on purpose). */
  function resetSignals() {
    state.metrics = null;
    state.error = '';
    setFace(false);
    noFaceSince = null;
  }

  return {
    state,

    /** From the consent click: unlock audio inside the gesture, then turn the camera on. */
    tuneIn() {
      void engine.prime();
      pulse.reset();
      state.tempo = null;
      resetSignals();
      source.start();
      go('tuning');
    },

    startPlaying,

    finish() {
      stopEverything();
      go('tape');
    },

    playAgain() {
      resetSignals();
      source.start();
      startPlaying();
    },

    turnOff() {
      stopEverything();
      resetRun();
      go('welcome');
    },

    backToStart() { go('welcome'); },

    summary() {
      const { bpmSum, bpmCount, breathSum, breathCount } = state.stats;
      return {
        avgBpm: Math.round(bpmCount ? bpmSum / bpmCount : (state.tempo ?? 72)),
        avgBreathing: breathCount ? Math.round(breathSum / breathCount) : null,
        tapes: state.unlocked.length,
      };
    },
  };
}

export type Session = ReturnType<typeof createSession>;
