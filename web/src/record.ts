// The 15 s clip (HANDOFF §7): the music plus a canvas "clip view" (never the camera), recorded in memory only.

export const CLIP_SECONDS = 15;
const W = 1280;
const H = 720;

const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
/** False where MediaRecorder can't make webm; the Record button stays hidden there. */
export const canRecord = MIME !== undefined;

export type ClipView = { tempo: number; colors: string[]; day: boolean; simulated: boolean };
export type Clip = { url: string; seconds: number };

/** Starts recording now. `stop()` ends early; `done` resolves with the clip (null if nothing was captured). */
export function recordClip(audio: MediaStream, view: () => ClipView, onTick: (secondsLeft: number) => void) {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  const video = canvas.captureStream(30);
  const recorder = new MediaRecorder(new MediaStream([...video.getVideoTracks(), ...audio.getAudioTracks()]), { mimeType: MIME });
  const chunks: Blob[] = [];
  const started = performance.now();
  let angle = 0;
  let last = started;
  let frame = 0;

  const loop = (now: number) => {
    const v = view();
    angle += ((now - last) / 1000) * (v.tempo / 240) * Math.PI * 2; // one turn per 4 beats, like the room vinyl
    last = now;
    draw(ctx, v, (now - started) / 1000, angle);
    frame = requestAnimationFrame(loop);
  };
  try { recorder.start(1000); } catch (e) { video.getTracks().forEach((t) => t.stop()); throw e; } // before any loop starts
  frame = requestAnimationFrame(loop);

  const ticker = setInterval(() => {
    const left = CLIP_SECONDS - Math.floor((performance.now() - started) / 1000);
    if (left <= 0) stop(); else onTick(left);
  }, 250);
  onTick(CLIP_SECONDS);

  function stop() {
    clearInterval(ticker);
    if (recorder.state !== 'inactive') recorder.stop();
  }

  const done = new Promise<Clip | null>((resolve) => {
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      cancelAnimationFrame(frame);
      video.getTracks().forEach((t) => t.stop());
      const seconds = Math.min(CLIP_SECONDS, Math.round((performance.now() - started) / 1000));
      // shortcut: Chrome's webm has no duration header (players show no seek bar until it ends), patch it with fix-webm-duration if that matters.
      resolve(chunks.length && seconds >= 1 ? { url: URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), seconds } : null);
    };
  });

  return { stop, done };
}

function draw(ctx: CanvasRenderingContext2D, v: ClipView, t: number, angle: number) {
  const ink = v.day ? '#2A2340' : '#F6EBDD';
  ctx.fillStyle = v.day ? '#F7DCC6' : '#24203F';
  ctx.fillRect(0, 0, W, H);

  // Vinyl: grooves, pink label, a shine that shows the spin.
  const cx = 360, cy = 360, r = 230;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = '#15132A';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1F1C3A';
  ctx.lineWidth = 2;
  for (let g = r - 12; g > 90; g -= 7) { ctx.beginPath(); ctx.arc(0, 0, g, 0, Math.PI * 2); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(246,235,221,.18)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0, r - 50, -2.4, -1.9); ctx.stroke();
  ctx.fillStyle = '#F2A7A0';
  ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#24203F';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Station frequency = heartbeat.
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = v.day ? '#9C5B12' : '#F4B860';
  ctx.font = '32px VT323, monospace';
  ctx.fillText("YOU'RE LISTENING TO", 700, 210);
  ctx.font = '170px VT323, monospace';
  ctx.fillText(`${v.tempo.toFixed(1)} FM`, 690, 350);
  ctx.fillStyle = ink;
  ctx.font = '40px Caveat, cursive';
  ctx.fillText('the station frequency is your heartbeat', 700, 410);

  // One wave per unlocked tape, pulsing with the beat (a faint one before the first unlock).
  const beat = (t * v.tempo) / 60;
  (v.colors.length ? v.colors : ['rgba(207,198,232,.35)']).forEach((color, i) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let x = 700; x <= 1200; x += 8) {
      const y = 500 + i * 34 + Math.sin(x / 40 + beat * Math.PI + i) * (10 + 6 * Math.sin(beat * Math.PI * 2));
      if (x === 700) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  ctx.fillStyle = v.day ? '#9C5B12' : '#F4B860';
  ctx.font = '800 30px "Bricolage Grotesque", sans-serif';
  ctx.fillText('beats to breathe to', 700, 670);

  if (v.simulated) { // never let a simulated clip pass as live
    ctx.fillStyle = '#D2564A';
    ctx.fillRect(1010, 30, 240, 56);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '40px VT323, monospace';
    ctx.fillText('SIMULATED', 1040, 70);
  }
}
