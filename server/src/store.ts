import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_DIR } from './config';
import type { Capture } from './types';
import { emitUpdate, emitRemoved } from './bus';

const captures = new Map<string, Capture>();

export function dirOf(id: string): string {
  return join(WORKSPACE_DIR, id);
}

export async function init(): Promise<void> {
  await mkdir(WORKSPACE_DIR, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(WORKSPACE_DIR);
  } catch {
    return;
  }
  for (const id of entries) {
    const metaPath = join(WORKSPACE_DIR, id, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const cap = JSON.parse(await readFile(metaPath, 'utf8')) as Capture;
      // Anything that was mid-flight when the server stopped can't be resumed.
      if (!['ready', 'failed'].includes(cap.status)) {
        if (cap.splatUrl) {
          cap.status = 'ready';
          cap.stage = 'ready';
          cap.progress = 1;
        } else {
          cap.status = 'failed';
          cap.stage = 'failed';
          cap.error = 'Interrupted by a server restart.';
          cap.message = 'Interrupted';
        }
      }
      captures.set(cap.id, cap);
    } catch {
      // skip unreadable
    }
  }
}

export function get(id: string): Capture | undefined {
  return captures.get(id);
}

export function list(): Capture[] {
  return [...captures.values()].sort((a, b) => b.createdAt - a.createdAt);
}

const persistTimers = new Map<string, NodeJS.Timeout>();

async function writeMeta(cap: Capture): Promise<void> {
  const metaPath = join(dirOf(cap.id), 'meta.json');
  try {
    await mkdir(dirOf(cap.id), { recursive: true });
    await writeFile(metaPath, JSON.stringify(cap, null, 2));
  } catch {
    // best-effort
  }
}

/** Store in memory, emit to clients now, and persist to disk (debounced). */
export function put(cap: Capture, opts: { flush?: boolean } = {}): void {
  captures.set(cap.id, cap);
  emitUpdate(cap);
  if (opts.flush) {
    const t = persistTimers.get(cap.id);
    if (t) clearTimeout(t);
    persistTimers.delete(cap.id);
    void writeMeta(cap);
    return;
  }
  if (!persistTimers.has(cap.id)) {
    persistTimers.set(
      cap.id,
      setTimeout(() => {
        persistTimers.delete(cap.id);
        void writeMeta(cap);
      }, 600),
    );
  }
}

export async function remove(id: string): Promise<void> {
  captures.delete(id);
  const t = persistTimers.get(id);
  if (t) clearTimeout(t);
  persistTimers.delete(id);
  try {
    await rm(dirOf(id), { recursive: true, force: true });
  } catch {
    // ignore
  }
  emitRemoved(id);
}
