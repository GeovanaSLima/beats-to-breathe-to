// `?recordaudio=1`: the session's music as a 16-bit stereo .wav, captured digitally from the engine's own mix
// (no mic, no system loopback; 256 kbps Opus, transparent for a video) so a demo video can use the real, live-driven audio.
// MediaRecorder encodes off the main thread, so a screen recorder running alongside can't starve the capture
// (a ScriptProcessor version came out empty while recording the screen). The result is decoded to WAV at the end,
// since video editors don't open webm audio.

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  .find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));

/** Starts capturing `stream` now; `stop(keep)` resolves with the .wav, or null when not kept (rejects with the reason it couldn't). */
export function recordWav(stream: MediaStream) {
  const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), { mimeType: MIME, audioBitsPerSecond: 256_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(1000);

  return {
    async stop(keep: boolean): Promise<Blob | null> {
      if (recorder.state !== 'inactive') {
        const stopped = new Promise((r) => { recorder.onstop = r; });
        recorder.stop();
        await stopped;
      }
      if (!keep) return null; // Turn off: don't decode what we'd throw away
      if (!chunks.length) throw new Error('no audio was captured');
      const audio = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await new Blob(chunks).arrayBuffer());
      return toWav(audio);
    },
  };
}

function toWav(audio: AudioBuffer): Blob {
  const left = audio.getChannelData(0);
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
  const pcm = new Int16Array(left.length * 2);
  for (let i = 0; i < left.length; i++) { pcm[2 * i] = toInt16(left[i]); pcm[2 * i + 1] = toInt16(right[i]); }
  return encodeWav([pcm], audio.sampleRate);
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
