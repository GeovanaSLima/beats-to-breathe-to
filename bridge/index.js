// beats to breathe to: bridge. SmartSpectra SDK (owns the webcam) -> JSON over ws://localhost:8787.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import {
  SmartSpectraSDK, CameraSelection, MetricType, breathingMetrics,
  ProcessingStatus, ValidationCode, SmartSpectraErrorCode,
} from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { toMessage } from './metrics.js';

const PORT = 8787;
const apiKey = process.env.PRESAGE_API_KEY;
if (!apiKey) {
  console.error('PRESAGE_API_KEY is missing. Copy .env.example to .env and add your key.');
  process.exit(1);
}

let sdk = null;
let last = null;      // last metrics message sent
let latest = null;    // latest decoded SDK packet since last tick
let faceDetected = false;
let tick = null;

const clients = new Set();
const send = (msg) => { const s = JSON.stringify(msg); for (const c of clients) c.send(s); };
const status = (state, message = '') => { console.log(`[status] ${state} ${message}`); send({ type: 'status', state, message }); };
const name = (table, v) => Object.keys(table).find((k) => table[k] === v) ?? v;

async function start() {
  if (sdk) return;
  last = latest = null;
  faceDetected = false;
  sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, MetricType.PULSE_RATE, MetricType.HRV],
    enableTelemetry: false, // the app promises no analytics; README discloses the remaining auth call
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
  sdk.on('metrics', (buf) => { latest = decodeMetrics(buf); });
  // Logged so we can see whether the SDK's automatic LLM vitals snapshots fire (see README privacy notes).
  sdk.on('insight', (_buf, id) => console.warn(`[sdk] insight received (request ${id}): vitals were sent to Presage`));
  sdk.on('error', (code, message, retryable) => {
    console.error(`[sdk] error ${name(SmartSpectraErrorCode, code)}: ${message} (retryable=${retryable})`);
    status('error', message);
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
    if (!latest && !last) return;
    last = toMessage(latest ?? {}, last, faceDetected);
    latest = null;
    console.log(`pulse ${fmt(last.pulse)} bpm${last.pulseStable ? ' ✓' : ''} · breathing ${fmt(last.breathing)} /min${last.breathingStable ? ' ✓' : ''} · hrv ${fmt(last.hrv)} ms · face ${last.faceDetected ? 'yes' : 'no'}`);
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
  last = latest = null;
  status('camera_off');
}

const fmt = (v) => (v == null ? '…' : v.toFixed(1));

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
    if (msg.type === 'start') start();
    else if (msg.type === 'stop') stop();
  });
  ws.on('close', () => { clients.delete(ws); if (!clients.size) stop(); });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`bridge listening on ws://localhost:${PORT} · debug page http://localhost:${PORT}`);
  console.log('camera stays off until an app sends {"type":"start"}');
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(); process.exit(0); });
