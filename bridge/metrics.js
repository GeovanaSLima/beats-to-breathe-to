// Turns a decoded SmartSpectra Metrics packet into the §4.2 "metrics" message.
// `last` holds the previous message so values persist between packets that omit a series.

const latest = (series) => (series?.length ? series[series.length - 1] : null);

export function toMessage(m, last, faceDetected, now = Date.now()) {
  const pulse = latest(m?.cardio?.pulseRate);
  const breathing = latest(m?.breathing?.rate);
  const hrv = latest(m?.cardio?.hrv);
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
