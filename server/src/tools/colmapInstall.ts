import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT, colmapIsBundled, brewExists } from '../config';

/**
 * COLMAP installation, driven by the same setup script the CLI uses so there's
 * one install path to maintain. Unlike Brush, COLMAP can't be silently
 * self-healed everywhere: only Windows has an official binary to fetch. On
 * macOS it means running Homebrew, which the user triggers explicitly from the
 * setup UI (the "Install COLMAP" button) rather than the server doing it
 * unprompted. Concurrent callers share one install.
 */
let inflight: Promise<boolean> | null = null;
let lastError: string | null = null;

export function colmapInstalling(): boolean {
  return inflight !== null;
}

export function colmapInstallError(): string | null {
  return lastError;
}

/** Can this platform install COLMAP without leaving the app? */
export function colmapAutoInstallable(): 'auto' | 'button' | 'manual' {
  if (process.platform === 'win32') return 'auto'; // fetch prebuilt zip
  if (process.platform === 'darwin' && brewExists()) return 'button'; // brew
  return 'manual'; // Linux (sudo) or macOS without Homebrew
}

export function installColmap(): Promise<boolean> {
  if (colmapIsBundled() || process.env.COLMAP_BIN) {
    lastError = null;
    return Promise.resolve(true);
  }
  if (inflight) return inflight;

  console.log('  Installing COLMAP via setup script…');
  inflight = new Promise<boolean>((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [join(PROJECT_ROOT, 'scripts', 'setup.mjs'), '--colmap-only'],
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
      const ok = code === 0;
      const tail = out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-3).join(' ');
      done(ok, ok ? null : tail || `setup exited with code ${code}`);
    });
  });
  return inflight;
}
