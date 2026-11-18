// Bridge → app message contract (HANDOFF §4.2).
export type Metrics = {
  type: 'metrics';
  ts: number;
  pulse: number | null;
  breathing: number | null;
  hrv: number | null;
  faceDetected: boolean;
  pulseStable: boolean;
  breathingStable: boolean;
};

export type Status = {
  type: 'status';
  state: 'camera_on' | 'camera_off' | 'no_face' | 'error';
  message: string;
};

export type Message = Metrics | Status;

export interface SignalSource {
  readonly simulated: boolean;
  start(): void;
  stop(): void;
  onMessage(cb: (msg: Message) => void): void;
}
