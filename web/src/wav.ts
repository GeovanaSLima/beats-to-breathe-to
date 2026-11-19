// `?recordaudio=1`: the session's music as a 16-bit stereo .wav, captured digitally from the engine's own mix
// (no mic, no system loopback) so a demo video can use the real, live-driven audio at full quality.

/** Starts capturing `stream` now; `stop()` resolves with the .wav. */
export function recordWav(stream: MediaStream) {
  const ctx = new AudioContext();
  void ctx.resume(); // auto-start into Playing has no fresh click; Safari would otherwise leave it suspended
  const source = ctx.createMediaStreamSource(stream);
  // shortcut: ScriptProcessor is deprecated but works everywhere with no worklet file; move to AudioWorklet if it's removed.
  const tap = ctx.createScriptProcessor(16384, 2, 2); // big buffer: survives main-thread hiccups
  const chunks: Int16Array[] = [];
  tap.onaudioprocess = (e) => {
    const left = e.inputBuffer.getChannelData(0);
    const right = e.inputBuffer.getChannelData(1);
    const pcm = new Int16Array(left.length * 2);
    for (let i = 0; i < left.length; i++) { pcm[2 * i] = toInt16(left[i]); pcm[2 * i + 1] = toInt16(right[i]); }
    chunks.push(pcm);
  };
  source.connect(tap);
  tap.connect(ctx.destination); // a ScriptProcessor only runs when connected; its output is silence

  return {
    async stop() {
      source.disconnect();
      tap.disconnect();
      await ctx.close();
      return encodeWav(chunks, ctx.sampleRate);
    },
  };
}

const toInt16 = (s: number) => Math.round(Math.max(-1, Math.min(1, s)) * 0x7fff);

/** Interleaved stereo 16-bit PCM chunks → a WAV file. */
export function encodeWav(chunks: Int16Array[], sampleRate: number): Blob {
  const bytes = chunks.reduce((n, c) => n + c.byteLength, 0);
  const h = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 2, true); // PCM, stereo
  h.setUint32(24, sampleRate, true); h.setUint32(28, sampleRate * 4, true); h.setUint16(32, 4, true); h.setUint16(34, 16, true);
  text(36, 'data'); h.setUint32(40, bytes, true);
  return new Blob([h.buffer, ...chunks.map((c) => c.buffer as ArrayBuffer)], { type: 'audio/wav' });
}
