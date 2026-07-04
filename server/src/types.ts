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
  splatUrl?: string; // cleaned + centered subject (default view)
  fullSplatUrl?: string; // full scene incl. environment (optional view)
  previewUrl?: string; // intermediate splat while training
  splatBytes?: number;
  gaussians?: number; // gaussians in the cleaned subject
  gaussiansFull?: number; // gaussians in the full scene

  startedAt?: number;
  finishedAt?: number;
}

/** WebSocket message envelope. */
export type ServerMessage =
  | { type: 'snapshot'; captures: Capture[] }
  | { type: 'update'; capture: Capture }
  | { type: 'removed'; id: string }
  | { type: 'log'; id: string; line: string };
