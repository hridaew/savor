import type { Stage } from './types';

export function formatBytes(n?: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(s?: number): string {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}

export function formatCount(n?: number): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function timeAgo(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function elapsed(a?: number, b?: number): string {
  if (!a) return '—';
  const end = b ?? Date.now();
  const s = Math.max(0, Math.round((end - a) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export interface StageMeta {
  key: Stage;
  short: string;
  label: string;
  color: string;
}

export const PIPELINE_STAGES: StageMeta[] = [
  { key: 'extracting', short: 'Frames', label: 'Extracting frames', color: 'var(--teal)' },
  { key: 'sfm', short: 'Geometry', label: 'Solving geometry', color: 'var(--blue)' },
  { key: 'training', short: 'Splat', label: 'Training splat', color: 'var(--orange)' },
];

export function stageColor(s: Stage): string {
  switch (s) {
    case 'extracting':
      return 'var(--teal)';
    case 'sfm':
      return 'var(--blue)';
    case 'training':
      return 'var(--orange)';
    case 'ready':
      return 'var(--green)';
    case 'failed':
      return 'var(--red)';
    default:
      return 'var(--label-3)';
  }
}

export function statusLabel(s: Stage): string {
  switch (s) {
    case 'queued':
      return 'Queued';
    case 'extracting':
      return 'Extracting';
    case 'sfm':
      return 'Solving';
    case 'training':
      return 'Training';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

export const QUALITY_INFO: Record<string, { title: string; blurb: string; time: string }> = {
  fast: { title: 'Fast', blurb: 'A quick look. Softer detail.', time: '~3k steps' },
  balanced: { title: 'Balanced', blurb: 'Great detail for most captures.', time: '~8k steps' },
  high: { title: 'High', blurb: 'Maximum sharpness. Takes longer.', time: '~20k steps' },
};
