import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT, brushExists } from '../config';

/**
 * Self-heal for the Brush binary: if it's missing (fresh clone, skipped
 * setup, deleted tools/), download it by running the same setup script that
 * `npm install` uses, so there is exactly one install path to maintain.
 * Concurrent callers share one download.
 */
let inflight: Promise<boolean> | null = null;
let lastError: string | null = null;

export function brushInstalling(): boolean {
  return inflight !== null;
}

export function brushInstallError(): string | null {
  return lastError;
}

export function ensureBrush(): Promise<boolean> {
  if (brushExists()) {
    lastError = null;
    return Promise.resolve(true);
  }
  if (inflight) return inflight;

  console.log('  Brush binary missing — downloading it now (this is a one-time step)…');
  inflight = new Promise<boolean>((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [join(PROJECT_ROOT, 'scripts', 'setup.mjs'), '--brush-only'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += String(d);
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      out += String(d);
      process.stderr.write(d);
    });
    const done = (ok: boolean, err: string | null) => {
      inflight = null;
      lastError = ok ? null : err;
      resolvePromise(ok);
    };
    child.on('error', (e) => done(false, String(e?.message ?? e)));
    child.on('close', (code) => {
      const ok = code === 0 && brushExists();
      // Strip ANSI color codes so the error reads clean in the UI.
      const tail = out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-3).join(' ');
      done(ok, ok ? null : tail || `setup exited with code ${code}`);
    });
  });
  return inflight;
}
