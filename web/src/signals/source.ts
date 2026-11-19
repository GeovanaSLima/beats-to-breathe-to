import type { Message, SignalSource } from './types.ts';
import { createSimulator } from './simulator.ts';

const BRIDGE_URL = 'ws://localhost:8787';

/** Live bridge by default; `?sim=1` or VITE_SIGNAL_SOURCE=sim swaps in the simulator. */
export function createSignalSource(): SignalSource {
  const sim = new URLSearchParams(location.search).get('sim') === '1' || import.meta.env.VITE_SIGNAL_SOURCE === 'sim';
  return sim ? createSimulator() : createBridgeClient();
}

function createBridgeClient(): SignalSource {
  let cb: (m: Message) => void = () => {};
  let ws: WebSocket | null = null;
  let wanted = false; // camera requested by the user

  const send = (type: 'start' | 'stop') => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type })); };

  const connect = () => {
    ws = new WebSocket(BRIDGE_URL);
    ws.onopen = () => { if (wanted) send('start'); };
    ws.onmessage = (e) => {
      try { cb(JSON.parse(e.data) as Message); } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      ws = null;
      if (!wanted) return;
      cb({ type: 'status', state: 'error', message: 'Bridge not running. Start it with `npm start` in the project folder.' });
      setTimeout(() => { if (wanted && !ws) connect(); }, 2000);
    };
  };

  return {
    simulated: false,
    onMessage(f) { cb = f; },
    start() {
      wanted = true;
      if (ws) send('start'); else connect();
    },
    stop() {
      wanted = false;
      send('stop');
      // Detach first so a quick re-start opens a fresh socket instead of reusing this closing one.
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
    },
  };
}
