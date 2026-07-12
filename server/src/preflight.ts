import { checkTools, hintFor, type Health } from './health';
import { brushInstalling, brushInstallError, ensureBrush } from './tools/brushInstall';
import {
  colmapInstalling,
  colmapInstallError,
  colmapAutoInstallable,
  installColmap,
} from './tools/colmapInstall';

/**
 * Cached tool health. A healthy result is cached for the process lifetime
 * (tools don't uninstall themselves mid-session); while unhealthy we re-check
 * at most every 10s so the UI's polling stays cheap.
 */
let cache: Health | null = null;
let checkedAt = 0;
let pending: Promise<Health> | null = null;

export async function getHealth(): Promise<Health> {
  if (!cache?.ok && (!cache || Date.now() - checkedAt >= 10_000)) {
    pending ??= checkTools().then((h) => {
      cache = h;
      checkedAt = Date.now();
      pending = null;
      return h;
    });
    await pending;
  }
  const h = cache!;
  const tools = { ...h.tools };

  // Overlay live install state — fresher than the 10s cache window.
  if (!tools.brush.ok) {
    const installing = brushInstalling();
    const err = brushInstallError();
    tools.brush = {
      ...tools.brush,
      action: 'auto',
      installing,
      detail: installing
        ? 'downloading — no action needed'
        : err
          ? `download failed: ${err}`
          : tools.brush.detail,
    };
  }
  if (!tools.colmap.ok) {
    const installing = colmapInstalling();
    const err = colmapInstallError();
    const action = colmapAutoInstallable();
    tools.colmap = {
      ...tools.colmap,
      action,
      installing,
      detail: installing
        ? action === 'auto'
          ? 'downloading — no action needed'
          : 'installing…'
        : err
          ? `install failed: ${err}`
          : tools.colmap.detail,
    };
  }
  return { ok: h.ok, tools };
}

export interface MissingTool {
  tool: 'ffmpeg' | 'ffprobe' | 'colmap' | 'brush';
  hint: string;
}

/**
 * Gate for starting new pipeline work. Returns the tools that block it.
 * Brush is special: it self-installs, so a missing Brush only blocks when a
 * download already failed (likely offline) — otherwise we kick the download
 * off here and let the pipeline await it before training.
 */
export async function preflightMissing(): Promise<MissingTool[]> {
  const h = await getHealth();
  const missing: MissingTool[] = [];
  for (const tool of ['ffmpeg', 'ffprobe'] as const) {
    if (!h.tools[tool].ok) missing.push({ tool, hint: h.tools[tool].hint ?? hintFor(tool) });
  }
  // COLMAP runs early (SfM) and can't be awaited mid-pipeline like Brush, so a
  // missing COLMAP always blocks new work. On Windows we still kick off the
  // automatic fetch so the block clears itself; elsewhere the UI offers the
  // install button / command.
  if (!h.tools.colmap.ok) {
    if (colmapAutoInstallable() === 'auto') void installColmap();
    missing.push({ tool: 'colmap', hint: h.tools.colmap.hint ?? hintFor('colmap') });
  }
  if (!h.tools.brush.ok) {
    const failedBefore = brushInstallError() !== null && !brushInstalling();
    // Start — or, after a failure, retry — the download. No-op while one is
    // already in flight, so this can't stack downloads.
    void ensureBrush();
    if (failedBefore) missing.push({ tool: 'brush', hint: hintFor('brush') });
  }
  return missing;
}
