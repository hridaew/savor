export type Stage = 'queued' | 'extracting' | 'sfm' | 'training' | 'ready' | 'failed';

export interface Capture {
  id: string;
  name: string;
  createdAt: number;
  status: Stage;
  stage: Stage;
  stageProgress: number;
  progress: number;
  message: string;
  error?: string;
  /** Legacy field from when quality was user-selectable. */
  quality?: string;
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  frameCount?: number;
  imagesRegistered?: number;
  sparsePoints?: number;
  totalSteps?: number;
  steps?: number;
  thumbUrl?: string;
  /** Rendered splat poster for the library card (replaces thumbUrl when set). */
  posterUrl?: string;
  splatUrl?: string;
  splatHqUrl?: string;
  /** Capture-camera orbit distance in normalized splat units (camera hint). */
  orbitRadius?: number;
  /** Capture-camera orbit height in normalized splat units (y, negative = above). */
  orbitHeight?: number;
  /** How this capture was filmed: orbit around an object, or inside a space. */
  kind?: 'object' | 'environment';
  /** Environment captures: median capture position (normalized splat units). */
  envCamPos?: [number, number, number];
  /** Environment captures: unit median view direction. */
  envCamDir?: [number, number, number];
  /** Legacy (pre-v2 captures): separate scene files. */
  fullSplatUrl?: string;
  fullSplatHqUrl?: string;
  previewUrl?: string;
  splatBytes?: number;
  splatBytesHq?: number;
  gaussians?: number;
  /** Legacy (pre-v2 captures). */
  gaussiansFull?: number;
  startedAt?: number;
  finishedAt?: number;
}

export type ServerMessage =
  | { type: 'snapshot'; captures: Capture[] }
  | { type: 'update'; capture: Capture }
  | { type: 'removed'; id: string }
  | { type: 'log'; id: string; line: string };

export interface ToolStatus {
  ok: boolean;
  version?: string;
  path: string;
  detail?: string;
  /** How to install this tool on the server's machine (present when !ok). */
  hint?: string;
  /** The server is downloading/installing it right now. */
  installing?: boolean;
  /** How the app can install this tool: auto-fetch, one-click, or manual command. */
  action?: 'auto' | 'button' | 'manual';
}
export interface Health {
  ok: boolean;
  tools: Record<'ffmpeg' | 'ffprobe' | 'colmap' | 'brush', ToolStatus>;
}
