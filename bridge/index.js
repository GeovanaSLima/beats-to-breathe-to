// beats to breathe to: bridge. SmartSpectra SDK (owns the webcam) -> JSON over ws://localhost:8787.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import {
  SmartSpectraSDK, CameraSelection, MetricType, breathingMetrics,
  ProcessingStatus, ValidationCode, SmartSpectraErrorCode,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { collect, toMessage } from './metrics.js';

const PORT = 8787;
const apiKey = process.env.PRESAGE_API_KEY;
if (!apiKey) {
  console.error('PRESAGE_API_KEY is missing. Copy .env.example to .env and add your key.');
  process.exit(1);
}

let sdk = null;
let last = null;      // last metrics message sent
let samples = {};     // newest SDK sample per signal since last tick
let faceDetected = false;
let tick = null;

const clients = new Set();
const send = (msg) => { const s = JSON.stringify(msg); for (const c of clients) c.send(s); };
const status = (state, message = '') => { console.log(`[status] ${state} ${message}`); send({ type: 'status', state, message }); };
const name = (table, v) => Object.keys(table).find((k) => table[k] === v) ?? v;

// Serialize start/stop: native SDK state is process-global, so a start must wait for the previous destroy.
let lifecycle = Promise.resolve();
const run = (fn) => (lifecycle = lifecycle.then(fn).catch((e) => status('error', e.message)));

async function start() {
  if (sdk) return;
  last = null;
  samples = {};
  faceDetected = false;
  sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV],
    enableTelemetry: false, // no usage/diagnostic reports; auth + LLM insights are disclosed in README
  });
  sdk.on('processingStatus', (s) => {
    console.log(`[sdk] processing ${name(ProcessingStatus, s)}`);
    if (s === ProcessingStatus.kRunning) status('camera_on');
  });
  let lastCode = null;
  sdk.on('validationStatus', (code, _ts, hint) => {
    const wasFace = faceDetected;
    faceDetected = code !== ValidationCode.kNoFaceFound;
    // The SDK reports every frame; log only changes.
    if (code !== lastCode) console.log(`[sdk] validation ${name(ValidationCode, code)} ${hint ?? ''}`);
    lastCode = code;
    if (wasFace !== faceDetected) status(faceDetected ? 'camera_on' : 'no_face', faceDetected ? '' : 'No face in view');
  });
  sdk.on('metrics', (buf) => { collect(decodeMetrics(buf), samples); });
  // Logged so we can see whether the SDK's automatic LLM vitals snapshots fire (see README privacy notes).
  sdk.on('insight', (_buf, id) => console.warn(`[sdk] insight received (request ${id}): vitals were sent to Presage`));
  sdk.on('error', (code, message, retryable) => {
    console.error(`[sdk] error ${name(SmartSpectraErrorCode, code)}: ${message} (retryable=${retryable})`);
    status('error', message);
    run(stop); // don't leave a dead session re-sending frozen metrics
  });

  sdk.useCamera(CameraSelection.default);
  try {
    sdk.start();
  } catch (e) {
    status('error', e.message);
    await stop();
    return;
  }
  tick = setInterval(() => {
    const { pulse, breathing, hrv } = samples;
    if (!pulse && !breathing && !hrv && !last) return;
    last = toMessage(samples, last, faceDetected);
    samples = {};
    console.log([
      describe('pulse', 'bpm', last.pulse, last.pulseStable, pulse, pulse?.value),
      describe('breathing', '/min', last.breathing, last.breathingStable, breathing, breathing?.value),
      describe('hrv', 'ms', last.hrv, false, hrv, hrv?.rmssd),
      `face ${last.faceDetected ? 'yes' : 'no'}`,
    ].join(' · '));
    send(last);
  }, 1000);
}

// Destroy (not just stop) so the camera is released for sure; the next start builds a fresh session.
async function stop() {
  clearInterval(tick);
  if (!sdk) return;
  const s = sdk;
  sdk = null;
  try { await s.stopAsync(); } catch {}
  await s.destroy();
  last = null;
  samples = {};
  status('camera_off');
}

const fmt = (v) => (v == null ? '…' : v.toFixed(1));

// Terminal line for one signal; while the contract still sends null, show the raw unstable SDK value.
function describe(label, unit, shown, stable, sample, rawValue) {
  const raw = shown == null && rawValue != null ? ` (raw ${rawValue.toFixed(1)}, ${Math.round(sample.confidence ?? 0)}%)` : '';
  return `${label} ${fmt(shown)} ${unit}${stable ? ' ✓' : ''}${raw}`;
}

// Plain HTTP only serves the debug page; the app talks over the WebSocket.
const server = createServer(async (req, res) => {
  if (req.url !== '/') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/html' }).end(await readFile(new URL('./debug.html', import.meta.url)));
});
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Only accept local pages: blocks other websites in the browser from reading the stream.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { ws.close(1008, 'origin not allowed'); return; }
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'status', state: sdk ? 'camera_on' : 'camera_off', message: '' }));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg?.type === 'start') run(start);
    else if (msg?.type === 'stop') run(stop);
  });
  ws.on('close', () => { clients.delete(ws); if (!clients.size) run(stop); });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`bridge listening on ws://localhost:${PORT} · debug page http://localhost:${PORT}`);
  console.log('camera stays off until an app sends {"type":"start"}');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await run(stop); process.exit(0); });
