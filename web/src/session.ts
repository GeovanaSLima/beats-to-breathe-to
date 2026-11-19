// App state machine (HANDOFF §4.5) and the signal → audio loop. No DOM here; main.ts renders `state`.
//   welcome → tuning → playing → tape → tuning (play again) | welcome (back)
//   "Turn off" from tuning/playing → welcome.
import { createSignalSource } from './signals/source.ts';
import type { Message, Metrics } from './signals/types.ts';
import { PulseTracker, StabilityMeter } from './signals/smoothing.ts';
import { createEngine, LAYERS, type Layer } from './audio/engine.ts';
import { hrvToSwing } from './audio/mapping.ts';

export type Screen = 'welcome' | 'tuning' | 'playing' | 'tape';

const AWAY_AFTER_MS = 5000;   // face or breathing unread this long while playing → turn down, dim the radio, wait
const AUTO_START_MS = 1500;   // tuning → playing once all three checks pass
const AWAY_VOLUME = 0.2;      // how far the music turns down while it waits for you

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
    hint: '',                       // SDK framing tip, e.g. "Place more of the chest in view." 
    steadySeconds: 0,
    unlocked: [] as Layer[],
    away: false,                    // playing, but face or breathing hasn't been read for AWAY_AFTER_MS
    stats: { bpmSum: 0, bpmCount: 0, breathSum: 0, breathCount: 0 },
  };

  let lostSince: number | null = null; // when the face or the breathing reading was last lost
  let autoStart: ReturnType<typeof setTimeout> | undefined;
  // Audio start/stop take time (fades); queue them so a quick "play again" can't be cut by a pending stop.
  let audioQueue = Promise.resolve();
  const audio = (fn: () => Promise<void>) => (audioQueue = audioQueue.then(fn).catch((e) => console.error(e)));

  const ready = () =>
    !!state.metrics && state.faceDetected && state.metrics.pulseStable && state.metrics.breathingStable && state.tempo !== null;

  /** The music only plays while the face is seen and breathing is being read. */
  function setReading(face: boolean, breathing: boolean) {
    state.faceDetected = face;
    if (face && breathing) lostSince = null;
    else lostSince ??= Date.now();
  }

  function onMetrics(m: Metrics) {
    state.metrics = m;
    setReading(m.faceDetected, m.breathingStable);
    // Without a face the bridge repeats stale values: hold the tempo and pause tape progress.
    if (!m.faceDetected) return;

    if (m.pulse !== null) {
      const target = pulse.push(m.pulse);
      if (target !== null) {
        state.tempo = target;
        if (state.screen === 'playing') engine.setTempo(target);
      }
    }
    const breathing = m.breathingStable ? m.breathing : null; // unread breathing shapes nothing
    if (breathing !== null) engine.setBreathing(breathing);
    if (m.hrv !== null) engine.setSwing(hrvToSwing(m.hrv));

    if (state.screen !== 'playing') return;
    if (m.pulse !== null) { state.stats.bpmSum += m.pulse; state.stats.bpmCount++; }
    if (breathing !== null) {
      state.stats.breathSum += breathing;
      state.stats.breathCount++;
      if (state.unlocked.length < LAYERS.length && steady.push(breathing, 1)) unlockNext();
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
      state.hint = msg.state === 'camera_on' || msg.state === 'no_face' ? msg.message : '';
      // camera_on doesn't mean a face was found; face presence comes from metrics.faceDetected.
      if (msg.state === 'no_face' || msg.state === 'error') setReading(false, false);
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
    if (state.screen !== 'playing') return; // leaving playing resets `away` and stops the music itself
    const away = lostSince !== null && Date.now() - lostSince > AWAY_AFTER_MS;
    if (away === state.away) return;
    state.away = away;
    audio(async () => engine.setVolume(away ? AWAY_VOLUME : 1));
    onChange();
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
    state.hint = '';
    state.faceDetected = false;
    lostSince = null;
  }

  return {
    state,

    /** From the consent click or Play again: unlock audio inside the gesture, turn the camera on, wait for a full reading. */
    tuneIn() {
      void engine.prime();
      pulse.reset();
      state.tempo = null;
      resetSignals();
      source.start();
      go('tuning');
    },

    startPlaying,

    audioStream: () => engine.audioStream(),

    finish() {
      stopEverything();
      go('tape');
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
