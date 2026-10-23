/** What the runtime drives: capture blur or the filter fallback, the same way. */

export interface CaptureMotionBlurHost {
  root: HTMLElement;
  fps: number;
  durationSeconds: () => number;
  /** The bound root timeline; movers are re-scanned when it changes. */
  timeline: () => unknown;
  now: () => number;
  /** Seek the timeline and adapters (not media) for a pose read. */
  seek: (t: number, suppressEvents: boolean) => void;
  ignoreMutations?: (write: () => void) => void;
}

export interface Config {
  shutterDeg: number;
  samples: number | null;
  events: boolean;
}

export interface Report {
  state: "on" | "off";
  tier: "capture" | "filter" | null;
  /** Why blur is off, or why the fallback is in use. */
  reason: string | null;
  reasonCode: string | null;
  movers: number;
  /** The blurred elements, as `tag#id.class`, for diagnosing what was (not) picked. */
  moverNames: string[];
  scanMs: number;
  shutterDeg: number;
  frames: number;
  meanMs: number;
  failures: number;
  failedFrames: number;
}

export interface Tier {
  root: HTMLElement;
  paint: (t: number, engineMode: boolean) => Promise<void>;
  probe: () => Report;
  rest: () => boolean;
  arm: () => void;
  finish: () => void;
  teardown: () => void;
  suspend: () => void;
  report: () => Report;
  busy: () => boolean;
  rediscover: () => void;
}
