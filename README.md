# beats to breathe to

A lo-fi radio that plays at your heart rate. Your webcam reads your pulse and breathing with the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/), and the music follows: your heartbeat sets the tempo, your breathing shapes the sound, and calm, steady breathing unlocks new cassette tapes (rain → piano → bass → melody). Every session ends as a tape only you could have played, and you can save a 15 s clip of it.

> This is a musical instrument, not a health tool.

## How it works

| Your signal | What it changes in the music |
|---|---|
| **Pulse** (bpm) | The tempo. Smoothed (EMA), kept between 60 and 110 bpm, ignores changes under 2 bpm and glides to the new tempo over 6 s. Shown as the station frequency, e.g. "72.0 FM". |
| **Breathing rate** (/min) | A low-pass filter and the reverb. Slow breathing (10/min or less) opens the sound up (8 kHz, more reverb). Fast breathing (18/min or more) muffles it (1.2 kHz, drier). Changes over 3 s. |
| **Breathing steadiness** | Unlocks tapes. Staying within ±2/min of your recent median for 20 s unlocks the next layer. Unsteady moments slow the counter down instead of resetting it. |
| **HRV** (RMSSD) | A little swing in the groove (more variability, more swing, up to 0.15). |

A drum loop with vinyl crackle plays the whole time. If the camera loses your face for 5 s, the tempo holds and the radio dims until you're back.

## Architecture

```
[Webcam] → [bridge/: Node + SmartSpectra SDK]
                 │  JSON metrics, about once a second
                 ▼
          WebSocket ws://localhost:8787 (localhost only)
                 ▼
[web/: Vite + TypeScript · Tone.js audio · DOM/CSS scene · canvas + MediaRecorder clip]
```

There is no browser version of the SDK, so a small local **bridge** runs the [Node SDK](https://www.npmjs.com/package/@smartspectra/node-sdk), owns the camera and sends numbers to the web app. The web app never sends the camera anywhere; it only opens it for the "live camera" polaroid while tuning in.

- `bridge/index.js`: SDK session, WebSocket server, start/stop.
- `web/src/signals/`: bridge client, simulator, smoothing and steadiness.
- `web/src/audio/`: the Tone.js engine and the signal → sound mapping.
- `web/src/session.ts`: the screen flow (welcome → tuning → playing → tape).
- `web/src/record.ts`: the 15 s clip.

## What you need

- macOS on Apple Silicon (what this was built and tested on). The SDK ships prebuilt runtimes for other platforms too; check its npm page.
- Node.js 22.18 or newer.
- A webcam.
- A free Presage API key: [register here](https://physiology.presagetech.com/auth/register).
- A browser that can record webm with MediaRecorder for clips (built and tested in Chrome). Where that's missing, the Record button is hidden.

## Setup

```bash
git clone git@github.com:GeovanaSLima/beats-to-breathe-to.git
cd beats-to-breathe-to
cp .env.example .env    # then paste your key after PRESAGE_API_KEY=
```

The key lives only in `.env`, which git ignores. The SDK's licensed runtime files come from npm into `node_modules/` and are never committed.

### Run it live

Terminal 1, the bridge:

```bash
cd bridge && npm install && npm start
```

You should see `bridge listening on ws://localhost:8787`. Its debug page at http://localhost:8787 shows the raw numbers. The first time, macOS asks for camera access **for your terminal app** (Terminal, iTerm, VS Code…), because the bridge is a Node process started from it. Allow it in System Settings → Privacy & Security → Camera if you missed the prompt.

Terminal 2, the web app:

```bash
cd web && npm install && npm run dev
```

Open http://localhost:5173, tick the consent box and press **Turn on camera & tune in**. Sit facing the camera in good, even light. Pulse usually locks in about 10 s; breathing can take 20 s or more.

### Run it with the simulator (no camera, no key)

```bash
cd web && npm install && npm run sim
```

This opens http://localhost:5173/?sim=1 (or set `VITE_SIGNAL_SOURCE=sim`). Fake signals wander around a calm pulse and breathing rate, and a red **SIMULATED** badge stays on screen. Clips made in this mode carry a SIMULATED label too.

Handy for demos: `?time=day` or `?time=night` overrides the clock-based theme.

### Tests

```bash
cd bridge && npm test
cd web && npm test
```

## Audio and asset licensing

- **All sound is synthesized live with [Tone.js](https://tonejs.github.io/)** (MIT): drums, vinyl crackle, rain, piano, bass, melody and the unlock chime. No samples or recordings are used.
- **Fonts:** Bricolage Grotesque, Caveat and VT323 from [Fontsource](https://fontsource.org/), all under the SIL Open Font License, bundled with the app (no requests to Google Fonts).
- **Illustrations:** hand-made SVG and CSS in this repo.

## Known limitations

- **Light and movement matter.** Low or uneven light, strong backlight, or moving around a lot makes the SDK's readings slower to settle or drop out.
- **Warm-up delay.** The SDK needs time to report stable values: about 10 s for pulse and 20 s or more for breathing.
- **Tempo lags on purpose.** Smoothing and the 6 s glide keep the music from jumping, so a pulse change shows up in the tempo after a few seconds.
- **Clip duration metadata.** Chrome writes webm files without a duration, so some players show no seek bar until the clip has played once. The clip itself is complete.
- **Clip recording needs the tab visible.** Browsers pause drawing in hidden tabs, so the clip's picture freezes if you switch away while recording.
- **Desktop only.** The SDK runs in the bridge on your computer, next to the browser.

## Privacy and data handling

- **Consent:** the camera turns on only after you tick a checkbox and press a button. You can turn it off at any time from every screen, and it turns off automatically on the final screen.
- **Images stay on your computer:** the camera is read by the Presage SmartSpectra SDK running locally inside the bridge. No camera image, video or audio is recorded, stored or sent anywhere.
- **What is sent to Presage:** the SDK turns the camera feed into numbers (pulse, breathing rate, HRV). Those numbers, never images, go to Presage, the company that makes the SDK, in two cases:
  - **API key check:** the SDK contacts Presage to validate the API key and subscription when a session starts.
  - **Automatic AI summaries:** the SDK also sends the measured numbers to Presage on its own, about every 60 seconds while the camera is on. Presage passes them to an AI model to generate a short summary ("LLM Insights"). This is built into the SDK and can't be turned off. This app never asks for, shows or stores those summaries. Presage's documentation does not say how long it keeps this data. See [Presage's LLM Insights docs](https://smartspectra.presagetech.com/docs/llm-insights).
- **SDK telemetry is off:** the bridge sets `enableTelemetry: false`, so the SDK sends no usage or diagnostic reports. See [Presage's telemetry docs](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).
- **Inside the app:** the numbers travel from the bridge to the browser over `localhost` only. They live in memory during the session and are discarded on stop or close. No accounts, no database, no cookies, no localStorage, no analytics.
- **Your clip:** the 15 s clip is drawn from the music and the on-screen visuals (no camera image). It is made in memory and saved only if you click Download.
- **Deletion:** closing the tab or pressing "Turn off" stops the camera and clears everything the app holds.
- **Not a health tool:** no diagnosis, no medical claims. Pulse and breathing are musical inputs only.
