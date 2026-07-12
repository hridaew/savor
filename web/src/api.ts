import type { Capture, Health } from './types';

export async function listCaptures(): Promise<Capture[]> {
  const r = await fetch('/api/captures');
  if (!r.ok) throw new Error('Failed to load captures');
  return r.json();
}

export async function getHealth(): Promise<Health> {
  const r = await fetch('/api/health');
  if (!r.ok) throw new Error('health check failed');
  return r.json();
}

/** Kick off a server-side COLMAP install (macOS Homebrew / Windows fetch). */
export async function installColmap(): Promise<void> {
  const r = await fetch('/api/setup/colmap', { method: 'POST' });
  if (!r.ok && r.status !== 202) {
    let msg = 'Could not start the COLMAP install';
    try {
      msg = (await r.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
}

export async function deleteCapture(id: string): Promise<void> {
  await fetch(`/api/captures/${id}`, { method: 'DELETE' });
}

export async function retryCapture(id: string): Promise<Capture> {
  const r = await fetch(`/api/captures/${id}/retry`, { method: 'POST' });
  if (!r.ok) {
    let msg = 'Retry failed';
    try {
      msg = (await r.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export interface CreateOpts {
  file: File;
  name?: string;
  onProgress?: (fraction: number) => void;
}

/** Upload via XHR so we get real upload-progress events. */
export function createCapture(opts: CreateOpts): Promise<Capture> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    if (opts.name) fd.append('name', opts.name);
    fd.append('video', opts.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/captures');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Bad server response'));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}
