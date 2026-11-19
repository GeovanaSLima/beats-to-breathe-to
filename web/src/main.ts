import '@fontsource/bricolage-grotesque/400.css';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';
import { startTheme } from './theme.ts';
import { createSession, type Screen } from './session.ts';
import { LAYERS, type Layer } from './audio/engine.ts';
import { spinVinyl, placeNeedle, confetti } from './scene.ts';
import { recordClip, canRecord, type Clip } from './record.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// Writes only changed text, so live regions don't re-announce on every render.
const bind = (key: string, text: string) =>
  document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`).forEach((el) => { if (el.textContent !== text) el.textContent = text; });

const consent = $<HTMLInputElement>('consent');
const tuneIn = $<HTMLButtonElement>('tune-in');
const previews = [$<HTMLVideoElement>('preview'), $<HTMLVideoElement>('preview-playing')];
const clipVideo = $<HTMLVideoElement>('clip-video');
const camPolaroid = document.querySelector<HTMLElement>('.cam-polaroid')!; // shown only once a stream is attached
// `?hidecam=1` keeps the camera image off screen (e.g. for a demo video); the bridge still reads the signals.
const hideCam = new URLSearchParams(location.search).get('hidecam') === '1';
const recordBtn = $<HTMLButtonElement>('record');
const download = $<HTMLAnchorElement>('download');
const LAYER_COLORS: Record<Layer, string> = { rain: '#8FB8DE', piano: '#F4B860', bass: '#F2A7A0', melody: '#A8D5A2' };
const root = document.documentElement;

const session = createSession(render, (layer) => {
  $('unlock-announce').textContent = `New tape unlocked: ${layer}`;
  confetti(document.querySelector<HTMLElement>(`[data-layer="${layer}"]`)!);
});
const { state } = session;

startTheme();
$('sim-badge').hidden = !state.simulated;
recordBtn.hidden = !canRecord;
spinVinyl($('vinyl'), () => (state.screen === 'playing' ? state.tempo ?? 72 : null));

let shown: Screen | null = null;
let previewStream: MediaStream | null = null;
let recording: ReturnType<typeof recordClip> | null = null;
let clip: Clip | null = null;

function render() {
  if (state.screen !== shown) enterScreen(state.screen);
  const m = state.metrics;
  const tempo = state.tempo ?? 72;

  bind('freq', tempo.toFixed(1));
  bind('hint', state.hint);
  root.style.setProperty('--beat', `${(60 / tempo).toFixed(3)}s`);
  root.style.setProperty('--reel', `${(240 / tempo).toFixed(2)}s`);
  if (m?.breathingStable && m.breathing) root.style.setProperty('--breath', `${(60 / m.breathing).toFixed(1)}s`);

  if (state.screen === 'tuning') renderTuning();
  if (state.screen === 'playing') renderPlaying();
}

function renderTuning() {
  const m = state.metrics;
  const checks = [state.faceDetected, !!m?.pulseStable, !!m?.breathingStable];
  const firstPending = checks.indexOf(false);
  ['step-face', 'step-pulse', 'step-breathing'].forEach((id, i) => {
    const step = checks[i] ? 'done' : i === firstPending ? 'active' : '';
    const li = $(id);
    if (li.className === step) return; // unchanged: don't make the live region re-announce
    li.className = step;
    li.querySelector('.sr-only')!.textContent = step === 'done' ? ', done' : step === 'active' ? ', checking' : ', waiting';
  });
  placeNeedle($('needle'), m?.pulseStable ? state.tempo : null);
  const msg = $('tuning-msg');
  if (msg.textContent !== state.error) msg.textContent = state.error;
  $('start-playing').hidden = firstPending !== -1 || state.tempo === null;
}

function renderPlaying() {
  const m = state.metrics;
  bind('pulse', m?.pulse != null ? `${Math.round(m.pulse)} bpm` : 'Reading…');
  bind('breathing', m?.breathingStable && m.breathing != null ? `${Math.round(m.breathing)}/min` : 'Reading…');

  $('radio-display').classList.toggle('dim', state.away);
  $('away-msg').hidden = !state.away;
  bind('away', state.error || "Can't see you, come back to the camera ✦");
  $('freq-note').hidden = state.away;

  const count = state.unlocked.length;
  bind('tapeCount', `${count}/4`);
  document.querySelectorAll<HTMLElement>('.tape').forEach((el) => {
    const on = state.unlocked.includes(el.dataset.layer as Layer);
    el.classList.toggle('on', on);
    el.setAttribute('aria-label', `${el.dataset.layer} tape, ${on ? 'playing' : 'locked'}`);
  });
  const allDone = count === LAYERS.length;
  $('next-tape').hidden = allDone;
  $('all-done').hidden = !allDone;
  if (!allDone) {
    bind('nextName', LAYERS[count]);
    bind('steady', String(Math.floor(state.steadySeconds)));
    $('progress-bar').style.width = `${(state.steadySeconds / 20) * 100}%`;
  }
}

function enterScreen(screen: Screen) {
  const firstRender = shown === null;
  shown = screen;
  document.body.dataset.screen = screen;
  for (const id of ['welcome', 'tuning', 'playing', 'tape'] as const) $(id).hidden = id !== screen;
  if (!firstRender) $(screen).focus(); // move screen-reader/keyboard focus to the new screen

  if (wantsPreview()) void startPreview(); else stopPreview();
  if (screen !== 'playing') recording?.stop(); // finish or turn off ends a recording early
  if (screen === 'tape') showClip(); else discardClip(); // the clip lives only until you leave the tape screen
  if (screen === 'welcome') { consent.checked = false; tuneIn.disabled = true; }
  if (screen === 'tape') {
    const { avgBpm, avgBreathing, tapes } = session.summary();
    bind('avgBpm', String(avgBpm));
    bind('avgBreathing', avgBreathing === null ? '–' : String(avgBreathing));
    bind('tapesUnlocked', `${tapes}/4`);
    const tapeName = document.querySelector('[data-copy="tapeName"]')!.textContent;
    document.querySelector('.cassette')!.setAttribute('aria-label', `Cassette tape labeled ${tapeName} · ${avgBpm} FM`);
  }
}

// Self-preview for the polaroids (tuning + playing). The bridge owns the camera for the SDK; this stream never leaves the tab.
const wantsPreview = () => state.screen === 'tuning' || state.screen === 'playing';

async function startPreview() {
  if (state.simulated || hideCam || previewStream) return; // tuning → playing keeps the same stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Left while the prompt was open, or an overlapping request already attached one: never orphan a stream.
    if (!wantsPreview() || previewStream) return stream.getTracks().forEach((t) => t.stop());
    previewStream = stream;
    for (const v of previews) { v.srcObject = stream; v.hidden = false; void v.play().catch(() => {}); }
    camPolaroid.hidden = false;
  } catch {
    // denied or no camera: keep the placeholder
  }
}

function stopPreview() {
  previewStream?.getTracks().forEach((t) => t.stop());
  previewStream = null;
  for (const v of previews) { v.srcObject = null; v.hidden = true; }
  camPolaroid.hidden = true;
}

function startRecording() {
  discardClip(); // a new recording replaces the previous one
  const rec = recordClip(
    session.audioStream(),
    () => ({ tempo: state.tempo ?? 72, colors: state.unlocked.map((l) => LAYER_COLORS[l]), day: root.dataset.theme === 'day', simulated: state.simulated }),
    (left) => { $('record-label').textContent = `Recording · ${left} s left`; },
  );
  recording = rec;
  recordBtn.setAttribute('aria-pressed', 'true');
  void rec.done.then((c) => {
    recording = null;
    recordBtn.setAttribute('aria-pressed', 'false');
    $('record-label').textContent = 'Record a 15 s clip';
    if (!c) return;
    if (state.screen === 'welcome') return URL.revokeObjectURL(c.url); // turned off mid-recording: drop it
    clip = c;
    $('unlock-announce').textContent = 'Clip ready, download it from your tape';
    if (state.screen === 'tape') showClip();
  });
}

function showClip() {
  bind('clipLength', clip ? `0:${String(clip.seconds).padStart(2, '0')}` : '–');
  download.hidden = clipVideo.hidden = !clip;
  if (clip) download.href = clipVideo.src = clip.url;
}

function discardClip() {
  if (clip) URL.revokeObjectURL(clip.url);
  clip = null;
  download.removeAttribute('href');
  clipVideo.removeAttribute('src');
  clipVideo.load(); // drop the decoded clip
}

// Chrome's webm has no duration, so the seek bar is broken until the end; seeking far makes it compute one.
clipVideo.onloadedmetadata = () => {
  if (clipVideo.duration !== Infinity) return;
  clipVideo.currentTime = 1e9;
  clipVideo.addEventListener('timeupdate', () => { clipVideo.currentTime = 0; }, { once: true });
};

recordBtn.onclick = () => (recording ? recording.stop() : startRecording());
consent.onchange = () => { tuneIn.disabled = !consent.checked; };
tuneIn.onclick = () => { if (consent.checked) session.tuneIn(); };
$('start-playing').onclick = () => session.startPlaying();
$('turn-off').onclick = () => session.turnOff();
$('finish').onclick = () => session.finish();
$('play-again').onclick = () => session.tuneIn(); // play again waits for a fresh reading too
$('back-to-start').onclick = () => session.backToStart();

render();
