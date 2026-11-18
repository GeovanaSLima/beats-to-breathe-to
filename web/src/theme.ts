// Day (06:00–17:59) / night by the local clock, re-checked every minute. `?time=day|night` overrides for demos.

const override = new URLSearchParams(location.search).get('time');

function isDay(now = new Date()) {
  if (override === 'day' || override === 'night') return override === 'day';
  const h = now.getHours();
  return h >= 6 && h < 18;
}

function copy(day: boolean, hour: number) {
  return {
    greeting: day ? (hour >= 5 && hour < 12 ? 'hey, good morning ✦' : 'hey, good afternoon ✦') : 'hey, good evening ✦',
    caption: day ? 'you, today' : 'you, tonight',
    tapeName: day ? 'Sunny Side' : 'Late Night',
    kicker: day ? 'today’s tape ✦' : 'tonight’s tape ✦',
    modeLabel: day ? 'day mode · set by your clock' : 'night mode · set by your clock',
  };
}

function apply() {
  const now = new Date();
  const day = isDay(now);
  document.documentElement.dataset.theme = day ? 'day' : 'night';
  const text = copy(day, now.getHours());
  document.querySelectorAll<HTMLElement>('[data-copy]').forEach((el) => {
    el.textContent = text[el.dataset.copy as keyof typeof text];
  });
}

export function startTheme() {
  apply();
  // Cross-fade only on later changes, not from the unstyled first paint.
  setTimeout(() => document.documentElement.style.setProperty('--fade', '2s'), 500);
  setInterval(apply, 60_000);
}
