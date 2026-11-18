// Signal-bound animation. Changing CSS animation-duration mid-loop jumps, so the vinyl angle is integrated in JS.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Spins `el` at one turn per 4 beats while `bpm()` returns a number; null = stopped. */
export function spinVinyl(el: HTMLElement, bpm: () => number | null) {
  let angle = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const b = bpm();
    if (b !== null && !reducedMotion.matches) {
      angle = (angle + ((now - last) / 1000) * (b / 240) * 360) % 360;
      el.style.transform = `rotate(${angle}deg)`;
    }
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Needle position on the 60–120 dial (ticks span 6%..94%, 20 px wide). null = keep sweeping. */
export function placeNeedle(needle: HTMLElement, bpm: number | null) {
  needle.classList.toggle('locked', bpm !== null);
  if (bpm === null) { needle.style.left = ''; return; }
  const t = Math.min(1, Math.max(0, (bpm - 60) / 60));
  needle.style.left = `calc(6% + 8px + (88% - 20px) * ${t.toFixed(3)})`;
}

const SPARK_COLORS = ['#F4B860', '#F2A7A0', '#8FB8DE', '#A8D5A2'];

/** A little burst of sparks from the middle of `host`; cleans itself up. */
export function confetti(host: HTMLElement) {
  if (reducedMotion.matches) return;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    const a = (i / 14) * Math.PI * 2;
    const r = 60 + Math.random() * 60;
    s.className = 'confetti';
    s.setAttribute('aria-hidden', 'true');
    s.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    s.style.setProperty('--dx', `${Math.cos(a) * r}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * r}px`);
    s.addEventListener('animationend', () => s.remove());
    host.append(s);
  }
}
