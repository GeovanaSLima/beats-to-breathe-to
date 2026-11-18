import '@fontsource/bricolage-grotesque/400.css';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';
import { startTheme } from './theme.ts';
import { createSession, type Screen } from './session.ts';
import { LAYERS } from './audio/engine.ts';
import { spinVinyl, placeNeedle, confetti } from './scene.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const bind = (key: string, text: string) =>
  document.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`).forEach((el) => { el.textContent = text; });

const consent = $<HTMLInputElement>('consent');
const tuneIn = $<HTMLButtonElement>('tune-in');
const preview = $<HTMLVideoElement>('preview');
const root = document.documentElement;

const session = createSession(render, (layer) => {
  $('unlock-announce').textContent = `New tape unlocked: ${layer}`;
  confetti(document.querySelector<HTMLElement>(`[data-layer="${layer}"]`)!);
});
const { state } = session;

startTheme();
$('sim-badge').hidden = !state.simulated;
spinVinyl($('vinyl'), () => (state.screen === 'playing' ? state.tempo ?? 72 : null));

let shown: Screen | null = null;

function render() {
  if (state.screen !== shown) enterScreen(state.screen);
  const m = state.metrics;
  const tempo = state.tempo ?? 72;

  bind('freq', tempo.toFixed(1));
  root.style.setProperty('--beat', `${(60 / tempo).toFixed(3)}s`);
  root.style.setProperty('--reel', `${(240 / tempo).toFixed(2)}s`);
  if (m?.breathing) root.style.setProperty('--breath', `${(60 / m.breathing).toFixed(1)}s`);

  if (state.screen === 'tuning') renderTuning();
  if (state.screen === 'playing') renderPlaying();
}

function renderTuning() {
  const m = state.metrics;
  const checks = [state.faceDetected, !!m?.pulseStable, !!m?.breathingStable];
  const firstPending = checks.indexOf(false);
  ['step-face', 'step-pulse', 'step-breathing'].forEach((id, i) => {
    $(id).className = checks[i] ? 'done' : i === firstPending ? 'active' : '';
  });
  placeNeedle($('needle'), m?.pulseStable ? state.tempo : null);
  $('tuning-msg').textContent = state.error;
  $('start-playing').hidden = firstPending !== -1 || state.tempo === null;
}

function renderPlaying() {
  const m = state.metrics;
  bind('pulse', m?.pulse != null ? `${Math.round(m.pulse)} bpm` : 'Reading…');
  bind('breathing', m?.breathing != null ? `${Math.round(m.breathing)}/min` : 'Reading…');

  $('radio-display').classList.toggle('dim', state.away);
  $('away-msg').hidden = !state.away;
  $('freq-note').hidden = state.away;

  const count = state.unlocked.length;
  bind('tapeCount', `${count}/4`);
  document.querySelectorAll<HTMLElement>('.tape').forEach((el) => {
    const on = state.unlocked.includes(el.dataset.layer as typeof LAYERS[number]);
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

  if (screen === 'tuning') void startPreview(); else stopPreview();
  if (screen === 'welcome') { consent.checked = false; tuneIn.disabled = true; }
  if (screen === 'tape') {
    const { avgBpm, avgBreathing, tapes } = session.summary();
    bind('avgBpm', String(avgBpm));
    bind('avgBreathing', avgBreathing === null ? '–' : String(avgBreathing));
    bind('tapesUnlocked', `${tapes}/4`);
    document.querySelector('.cassette')!.setAttribute('aria-label', `Cassette tape labeled ${document.querySelector('[data-copy="tapeName"]')!.textContent} · ${avgBpm} FM`);
  }
}

// Self-preview for the polaroid only. The bridge owns the camera for the SDK; this stream never leaves the tab.
async function startPreview() {
  if (state.simulated) return;
  try {
    preview.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
    if (state.screen !== 'tuning') return stopPreview(); // left the screen while the prompt was open
    preview.hidden = false;
    await preview.play();
  } catch {
    preview.hidden = true; // keep the dashed placeholder
  }
}

function stopPreview() {
  (preview.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  preview.srcObject = null;
  preview.hidden = true;
}

consent.onchange = () => { tuneIn.disabled = !consent.checked; };
tuneIn.onclick = () => { if (consent.checked) session.tuneIn(); };
$('start-playing').onclick = () => session.startPlaying();
$('turn-off').onclick = () => session.turnOff();
$('finish').onclick = () => session.finish();
$('play-again').onclick = () => session.playAgain();
$('back-to-start').onclick = () => session.backToStart();

render();
