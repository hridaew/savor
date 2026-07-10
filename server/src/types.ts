export type Stage =
  | 'queued'
  | 'extracting'
  | 'sfm'
  | 'training'
  | 'ready'
  | 'failed';

/** A single capture = one video → one gaussian splat. */
export interface Capture {
  id: string;
  name: string;
  createdAt: number;

  status: Stage; // terminal-ish view: queued|extracting|sfm|training|ready|failed
  stage: Stage; // current active stage
  stageProgress: number; // 0..1 within the current stage
  progress: number; // 0..1 overall (weighted across stages)
  message: string; // human-readable status line
  error?: string;

  /** Legacy field from when quality was user-selectable; kept for old metas. */
  quality?: string;

  // capture stats (filled in progressively)
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  frameCount?: number;
  imagesRegistered?: number;
  sparsePoints?: number;
  totalSteps?: number;
  steps?: number;

  // outputs
  thumbUrl?: string;
  /** Rendered splat poster for the library card (replaces thumbUrl when set). */
  posterUrl?: string;
  splatUrl?: string; // cleaned + centered scene (fast fallback)
  splatHqUrl?: string; // high-fidelity scene (full SH / beauty mode)
  /** Legacy (pre-v2 captures): scene file when subject/scene were separate. */
  fullSplatUrl?: string;
  /** Legacy (pre-v2 captures): HQ scene file when subject/scene were separate. */
  fullSplatHqUrl?: string;
  /** Capture-camera orbit distance in normalized splat units (Scene camera hint). */
  orbitRadius?: number;
  /** Capture-camera orbit height in normalized splat units (y, negative = above). */
  orbitHeight?: number;
  /** How this capture was filmed: orbit around an object, or inside a space. */
  kind?: 'object' | 'environment';
  /** Environment captures: median capture position (normalized splat units). */
  envCamPos?: [number, number, number];
  /** Environment captures: unit median view direction. */
  envCamDir?: [number, number, number];
  previewUrl?: string; // intermediate splat while training
  splatBytes?: number;
  splatBytesHq?: number;
  gaussians?: number; // gaussians in the cleaned scene
  /** Legacy (pre-v2 captures): gaussians in the separate full-scene file. */
  gaussiansFull?: number;

  startedAt?: number;
  finishedAt?: number;
}

/** WebSocket message envelope. */
export type ServerMessage =
  | { type: 'snapshot'; captures: Capture[] }
  | { type: 'update'; capture: Capture }
  | { type: 'removed'; id: string }
  | { type: 'log'; id: string; line: string };
