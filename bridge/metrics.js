// Turns decoded SmartSpectra Metrics packets into the §4.2 "metrics" message.

const latest = (series) => (series?.length ? series[series.length - 1] : undefined);

// Keep the newest sample of each signal; packets can arrive faster than we send and may omit series.
export function collect(m, into) {
  into.pulse = latest(m?.cardio?.pulseRate) ?? into.pulse;
  into.breathing = latest(m?.breathing?.rate) ?? into.breathing;
  into.hrv = latest(m?.cardio?.hrv) ?? into.hrv;
  return into;
}

// `last` is the previous message so values persist between ticks without new samples.
export function toMessage({ pulse, breathing, hrv }, last, faceDetected, now = Date.now()) {
  // Contract: a field stays null until the SDK reports its first stable sample.
  const pick = (s, v, prev) => (s && (s.stable || prev !== null) ? v : prev);
  return {
    type: 'metrics',
    ts: now,
    pulse: pick(pulse, pulse?.value, last?.pulse ?? null),
    breathing: pick(breathing, breathing?.value, last?.breathing ?? null),
    hrv: pick(hrv, hrv?.rmssd, last?.hrv ?? null),
    faceDetected,
    pulseStable: pulse ? !!pulse.stable : (last?.pulseStable ?? false),
    breathingStable: breathing ? !!breathing.stable : (last?.breathingStable ?? false),
  };
}
