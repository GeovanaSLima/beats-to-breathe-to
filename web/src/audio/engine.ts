import * as Tone from 'tone';
import { breathingToTone } from './mapping.ts';

// Everything is synthesized (no samples, no licensing). Tempo/filter/reverb are slow macro
// parameters ramped from the signals; notes are scheduled on the Transport grid, never from the signal.

export const LAYERS = ['rain', 'piano', 'bass', 'melody'] as const;
export type Layer = typeof LAYERS[number];

const STEPS = 16; // one bar of 16ths
const at = (...steps: number[]) => (s: number) => steps.includes(s);
const KICK = at(0, 7, 10);
const SNARE = at(4, 12);

// ii–V–I–vi in C, rootless jazzy voicings; one chord per bar.
const CHORDS = [
  ['F3', 'A3', 'C4', 'E4'], // Dm9
  ['F3', 'B3', 'E4', 'A4'], // G13
  ['E3', 'G3', 'B3', 'D4'], // Cmaj9
  ['G3', 'C4', 'E4', 'B4'], // Am9
];
const ROOTS = ['D2', 'G1', 'C2', 'A1'];
const PENTATONIC = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6'];

export function createEngine() {
  const transport = Tone.getTransport();
  transport.swingSubdivision = '8n';

  // Master chain: music → breathing filter → reverb → limiter → speakers.
  const master = new Tone.Gain(0);
  const filter = new Tone.Filter({ type: 'lowpass', frequency: 8000, rolloff: -24, Q: 0.7 });
  const reverb = new Tone.Reverb({ decay: 4, preDelay: 0.02, wet: 0.45 });
  const limiter = new Tone.Limiter(-1);
  master.chain(filter, reverb, limiter, Tone.getDestination());

  // Base drum loop: always on once tuned in.
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 5, envelope: { attack: 0.001, decay: 0.35, sustain: 0 }, volume: -6 }).connect(master);
  const snare = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -14 })
    .connect(new Tone.Filter(1800, 'bandpass').connect(master));
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 }, volume: -26 })
    .connect(new Tone.Filter(8000, 'highpass').connect(master));
  // Vinyl: a quiet hiss bed plus random clicks.
  const hiss = new Tone.Noise({ type: 'pink', volume: -44 }).connect(new Tone.Filter(1200, 'highpass').connect(master));
  const crackle = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.006, sustain: 0 }, volume: -30 }).connect(master);

  // Tape layers, each behind its own gain so unlocks fade in.
  const gains = Object.fromEntries(LAYERS.map((l) => [l, new Tone.Gain(0).connect(master)])) as Record<Layer, Tone.Gain>;
  const unlocked = new Set<Layer>();

  const rain = new Tone.Noise({ type: 'pink', volume: -22 })
    .chain(new Tone.Filter(400, 'highpass'), new Tone.Filter(2600, 'lowpass'), gains.rain);
  const piano = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.03, decay: 1.4, sustain: 0.25, release: 2.5 },
    volume: -20,
  }).connect(gains.piano);
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    filter: { Q: 1, type: 'lowpass' },
    envelope: { attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.6 },
    filterEnvelope: { attack: 0.01, decay: 0.3, sustain: 0.4, baseFrequency: 120, octaves: 2 },
    volume: -10,
  }).connect(gains.bass);
  const melody = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.5, sustain: 0.1, release: 1.2 },
    volume: -16,
  }).chain(new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.3, wet: 0.3 }), gains.melody);

  // Unlock chime skips the breathing filter so it always sparkles through.
  const chimeSynth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3, modulationIndex: 2,
    envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1.5 },
    volume: -14,
  }).connect(reverb);

  const ticksPer16th = transport.PPQ / 4;
  transport.scheduleRepeat((time) => {
    const tick = Math.round(transport.getTicksAtTime(time) / ticksPer16th);
    const step = tick % STEPS;
    const bar = Math.floor(tick / STEPS) % CHORDS.length;

    if (KICK(step)) kick.triggerAttackRelease('C1', '8n', time, step === 7 ? 0.6 : 1);
    if (SNARE(step)) snare.triggerAttackRelease('16n', time, 0.8);
    if (step % 2 === 0 && Math.random() > 0.1) hat.triggerAttackRelease('32n', time, step % 4 === 0 ? 0.9 : 0.5);
    if (Math.random() < 0.12) crackle.triggerAttackRelease('64n', time, 0.3 + Math.random() * 0.7);

    if (unlocked.has('piano') && step === 0) piano.triggerAttackRelease(CHORDS[bar], '1m', time, 0.6);
    if (unlocked.has('bass') && (step === 0 || step === 10)) bass.triggerAttackRelease(ROOTS[bar], step === 0 ? '4n.' : '8n', time, 0.8);
    if (unlocked.has('melody') && step % 2 === 0 && Math.random() < 0.22) {
      melody.triggerAttackRelease(PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)], '8n', time, 0.4 + Math.random() * 0.4);
    }
  }, '16n');

  let tap: MediaStreamAudioDestinationNode | undefined;

  return {
    get bpm() { return transport.bpm.value; },

    /** The final mix as a MediaStream, for the clip recorder. */
    audioStream() {
      if (!tap) { tap = Tone.getContext().createMediaStreamDestination(); limiter.connect(tap); }
      return tap.stream;
    },
    get unlocked() { return LAYERS.filter((l) => unlocked.has(l)); },

    /** Unlock audio; call inside a click handler (autoplay rules). */
    prime: () => Tone.start(),

    async start(bpm: number) {
      await reverb.ready;
      transport.bpm.value = bpm;
      hiss.start();
      transport.start('+0.05');
      master.gain.setValueAtTime(0, Tone.now()); // fade in from silence even after an interrupted stop
      master.gain.rampTo(1, 1.5);
    },

    /** Fade out, then stop and forget unlocked layers. */
    async stop() {
      master.gain.rampTo(0, 1.5);
      await new Promise((r) => setTimeout(r, 1600));
      transport.stop();
      for (const n of [hiss, rain]) if (n.state === 'started') n.stop();
      for (const l of LAYERS) gains[l].gain.value = 0;
      unlocked.clear();
    },

    setTempo(bpm: number) { transport.bpm.rampTo(bpm, 3); },

    /** Overall level (1 = full); used to play the tape softly and to duck it under the clip. */
    setVolume(level: number) { master.gain.rampTo(level, 0.8); },

    setBreathing(rate: number) {
      const { cutoff, wet } = breathingToTone(rate);
      filter.frequency.rampTo(cutoff, 3);
      reverb.wet.rampTo(wet, 3);
    },

    setSwing(amount: number) { transport.swing = amount; },

    /** Fade in the next locked layer; returns it, or null when all are on. */
    unlockNext(): Layer | null {
      const next = LAYERS.find((l) => !unlocked.has(l));
      if (!next) return null;
      unlocked.add(next);
      if (next === 'rain') rain.start();
      gains[next].gain.rampTo(1, 3);
      return next;
    },

    chime() {
      const now = Tone.now();
      ['E6', 'G6', 'C7'].forEach((n, i) => chimeSynth.triggerAttackRelease(n, '8n', now + i * 0.09, 0.6));
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
