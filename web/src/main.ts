// Milestone 2 test harness: wires signals → audio. Milestone 3 replaces this with the screens + state machine.
import { createSignalSource } from './signals/source.ts';
import { PulseTracker, StabilityMeter } from './signals/smoothing.ts';
import { createEngine, LAYERS } from './audio/engine.ts';
import { breathingToTone, hrvToSwing } from './audio/mapping.ts';

const $ = (id: string) => document.getElementById(id)!;
const source = createSignalSource();
const engine = createEngine();
const pulse = new PulseTracker();
const steady = new StabilityMeter();
let playing = false;
let starting = false;

$('badge').textContent = source.simulated ? 'SIMULATED' : 'LIVE';
$('badge').className = `badge ${source.simulated ? 'sim' : 'live'}`;

const reading = (v: number | null, unit: string) => (v == null ? 'Reading…' : `${v.toFixed(1)} ${unit}`);

source.onMessage(async (msg) => {
  if (msg.type === 'status') {
    $('status').textContent = `${msg.state}${msg.message ? ` · ${msg.message}` : ''}`;
    return;
  }
  $('pulse').textContent = reading(msg.pulse, 'bpm');
  $('breathing').textContent = reading(msg.breathing, '/min');

  if (msg.pulse != null) {
    const target = pulse.push(msg.pulse);
    if (target != null) {
      $('target').textContent = `${target.toFixed(1)} bpm`;
      if (playing) engine.setTempo(target);
      else if (!starting) {
        starting = true;
        try {
          await engine.start(target);
          playing = true;
        } finally {
          starting = false;
        }
      }
    }
  }

  if (msg.breathing != null) {
    engine.setBreathing(msg.breathing);
    const { cutoff, wet } = breathingToTone(msg.breathing);
    $('tone').textContent = `${Math.round(cutoff)} Hz · wet ${wet.toFixed(2)}`;
    // Steady breathing only counts while the music plays, the face is in view and tapes remain.
    if (playing && msg.faceDetected && engine.unlocked.length < LAYERS.length && steady.push(msg.breathing, 1)) {
      const layer = engine.unlockNext();
      engine.chime();
      $('announce').textContent = `New tape unlocked: ${layer}`;
    }
    const done = engine.unlocked.length === LAYERS.length;
    ($('steady') as HTMLProgressElement).value = done ? 20 : steady.progress;
    $('steadyText').textContent = done ? 'all tapes playing. such a vibe ✦' : `${Math.floor(steady.progress)}/20 s`;
    $('tapes').textContent = `${engine.unlocked.length}/4 ${engine.unlocked.join(', ')}`;
  }

  if (msg.hrv != null) {
    const swing = hrvToSwing(msg.hrv);
    engine.setSwing(swing);
    $('hrv').textContent = `${msg.hrv.toFixed(0)} ms · swing ${swing.toFixed(2)}`;
  }
});

$('tune').onclick = async () => {
  await engine.prime(); // inside the click: browsers only allow audio after a gesture
  ($('tune') as HTMLButtonElement).disabled = true;
  ($('off') as HTMLButtonElement).disabled = false;
  $('status').textContent = 'connecting…';
  source.start();
};

$('off').onclick = async () => {
  ($('off') as HTMLButtonElement).disabled = true;
  source.stop();
  await engine.stop();
  playing = false;
  pulse.reset();
  steady.reset();
  ($('steady') as HTMLProgressElement).value = 0;
  $('steadyText').textContent = '0/20 s';
  $('tapes').textContent = '0/4';
  for (const id of ['pulse', 'target', 'bpm', 'breathing', 'tone', 'hrv', 'announce']) $(id).textContent = '–';
  ($('tune') as HTMLButtonElement).disabled = false;
};

setInterval(() => { if (playing) $('bpm').textContent = `${engine.bpm.toFixed(1)} bpm`; }, 250);
