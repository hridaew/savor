export type Stage = 'queued' | 'extracting' | 'sfm' | 'training' | 'ready' | 'failed';
export type Quality = 'fast' | 'balanced' | 'high';

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
  quality: Quality;
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
  splatUrl?: string;
  fullSplatUrl?: string;
  previewUrl?: string;
  splatBytes?: number;
  gaussians?: number;
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
}
export interface Health {
  ok: boolean;
  tools: Record<'ffmpeg' | 'ffprobe' | 'colmap' | 'brush', ToolStatus>;
}
