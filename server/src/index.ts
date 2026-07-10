import http from 'node:http';
import { extname, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';

import { PORT, WORKSPACE_DIR, SAMPLES_DIR, UPLOAD } from './config';
import type { Capture, ServerMessage } from './types';
import * as store from './store';
import { bus } from './bus';
import { runPipeline } from './pipeline';
import { checkTools } from './health';
import { probe } from './tools/ffmpeg';

await store.init();

// ── Upload handling ────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req: Request & { jobId?: string }, _file, cb) => {
      const dir = store.dirOf(req.jobId!);
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, 'source' + (extname(file.originalname) || '.mp4')),
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 }, // 8 GB
});

// ── Sequential job queue (one heavy job at a time) ─────────────────────
const queue: string[] = [];
const sourcePaths = new Map<string, string>();
let running = false;

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|mpeg|mpg|wmv)$/i;

function looksLikeVideo(file: { mimetype?: string; originalname?: string }): boolean {
  return (
    file.mimetype?.toLowerCase().startsWith('video/') === true ||
    VIDEO_EXT_RE.test(file.originalname ?? '')
  );
}

function cleanupRejectedUpload(id: string): void {
  try {
    rmSync(store.dirOf(id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function processNext(): void {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  const cap = store.get(id);
  const videoPath = sourcePaths.get(id);
  if (!cap || !videoPath) {
    processNext();
    return;
  }
  running = true;
  runPipeline(cap, videoPath)
    .catch(() => {})
    .finally(() => {
      sourcePaths.delete(id);
      running = false;
      setImmediate(processNext);
    });
}

// ── App ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.use(
  '/files',
  express.static(WORKSPACE_DIR, {
    setHeaders: (res, path) => {
      if (path.endsWith('.ply')) res.setHeader('Content-Type', 'application/octet-stream');
    },
  }),
);
app.use('/samples', express.static(SAMPLES_DIR));

app.get('/api/health', async (_req, res) => {
  res.json(await checkTools());
});

app.get('/api/captures', (_req, res) => {
  res.json(store.list());
});

app.get('/api/captures/:id', (req, res) => {
  const cap = store.get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'not found' });
  res.json(cap);
});

app.get('/api/captures/:id/logs', (req, res) => {
  const tool = String(req.query.tool || 'brush').replace(/[^a-z]/gi, '');
  try {
    const text = readFileSync(join(store.dirOf(req.params.id), 'logs', `${tool}.log`), 'utf8');
    res.type('text/plain').send(text.slice(-20000));
  } catch {
    res.status(404).type('text/plain').send('no logs yet');
  }
});

// Rendered splat poster for the library card (client renders it offscreen
// once a capture is ready, then posts the JPEG here).
app.post(
  '/api/captures/:id/poster',
  express.raw({ type: 'image/jpeg', limit: '10mb' }),
  (req, res) => {
    const cap = store.get(req.params.id);
    if (!cap) return res.status(404).json({ error: 'not found' });
    if (cap.status !== 'ready') return res.status(409).json({ error: 'capture not ready' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) {
      return res.status(400).json({ error: 'expected a JPEG body' });
    }
    const posterPath = join(store.dirOf(cap.id), 'poster.jpg');
    writeFileSync(posterPath, req.body);
    cap.posterUrl = `/files/${cap.id}/poster.jpg?v=${Date.now() % 1e7}`;
    store.put(cap, { flush: true });
    res.json({ ok: true, posterUrl: cap.posterUrl });
  },
);

app.post(
  '/api/captures',
  (req: Request & { jobId?: string }, _res, next) => {
    req.jobId = nanoid(10);
    next();
  },
  upload.single('video'),
  async (req: Request & { jobId?: string }, res) => {
    if (!req.file) return res.status(400).json({ error: 'no video uploaded (field "video")' });
    const id = req.jobId!;

    if (!looksLikeVideo(req.file)) {
      cleanupRejectedUpload(id);
      return res.status(415).json({ error: 'Please upload a video file (mp4/mov/webm/mkv).' });
    }

    let info: Awaited<ReturnType<typeof probe>>;
    try {
      info = await probe(req.file.path);
    } catch {
      cleanupRejectedUpload(id);
      return res
        .status(400)
        .json({ error: 'Could not read a valid video track from this file.' });
    }

    const longEdge = Math.max(info.width || 0, info.height || 0);
    if (
      !Number.isFinite(info.durationSec) ||
      !Number.isFinite(info.fps) ||
      info.durationSec <= 0 ||
      info.fps <= 0 ||
      info.width <= 0 ||
      info.height <= 0
    ) {
      cleanupRejectedUpload(id);
      return res.status(400).json({
        error: 'This video metadata looks invalid. Try exporting/re-encoding and uploading again.',
      });
    }
    if (info.durationSec < UPLOAD.minDurationSec) {
      cleanupRejectedUpload(id);
      return res.status(400).json({
        error: `Video is too short (${info.durationSec.toFixed(
          1,
        )}s). Please upload at least ${UPLOAD.minDurationSec}s.`,
      });
    }
    if (info.durationSec > UPLOAD.maxDurationSec) {
      cleanupRejectedUpload(id);
      return res.status(400).json({
        error: `Video is too long (${Math.round(
          info.durationSec,
        )}s). Please keep captures under ${UPLOAD.maxDurationSec}s.`,
      });
    }
    if (longEdge < UPLOAD.minLongEdgePx || longEdge > UPLOAD.maxLongEdgePx) {
      cleanupRejectedUpload(id);
      return res.status(400).json({
        error: `Unsupported resolution (${info.width}×${info.height}). Use videos between ${UPLOAD.minLongEdgePx}px and ${UPLOAD.maxLongEdgePx}px on the long edge.`,
      });
    }

    const rawName = (req.body?.name as string) || req.file.originalname.replace(/\.[^.]+$/, '');
    const name = rawName.trim().slice(0, 80) || 'Untitled capture';

    const cap: Capture = {
      id,
      name,
      createdAt: Date.now(),
      status: 'queued',
      stage: 'queued',
      stageProgress: 0,
      progress: 0,
      message: 'Queued',
      durationSec: info.durationSec,
      fps: info.fps,
      width: info.width,
      height: info.height,
    };
    store.put(cap, { flush: true });
    sourcePaths.set(id, req.file.path);
    queue.push(id);
    processNext();
    res.status(201).json(cap);
  },
);

app.post('/api/captures/:id/retry', (req, res) => {
  const cap = store.get(req.params.id);
  if (!cap) return res.status(404).json({ error: 'not found' });
  const dir = store.dirOf(cap.id);
  let src: string | undefined;
  try {
    src = readdirSync(dir).find((f) => f.startsWith('source.'));
  } catch {
    /* ignore */
  }
  if (!src) return res.status(400).json({ error: 'Original video is no longer available.' });

  // Clear derived artifacts so the pipeline runs clean.
  for (const sub of ['images', 'sparse', 'output', 'logs', 'database.db']) {
    rmSync(join(dir, sub), { recursive: true, force: true });
  }
  Object.assign(cap, {
    status: 'queued',
    stage: 'queued',
    stageProgress: 0,
    progress: 0,
    message: 'Queued',
    error: undefined,
    splatUrl: undefined,
    splatHqUrl: undefined,
    previewUrl: undefined,
    posterUrl: undefined,
    splatBytes: undefined,
    splatBytesHq: undefined,
    gaussians: undefined,
    gaussiansFull: undefined,
    fullSplatUrl: undefined,
    fullSplatHqUrl: undefined,
    orbitRadius: undefined,
    orbitHeight: undefined,
    steps: undefined,
    imagesRegistered: undefined,
    sparsePoints: undefined,
    finishedAt: undefined,
  });
  store.put(cap, { flush: true });
  sourcePaths.set(cap.id, join(dir, src));
  queue.push(cap.id);
  processNext();
  res.json(cap);
});

app.delete('/api/captures/:id', async (req, res) => {
  await store.remove(req.params.id);
  res.json({ ok: true });
});

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Video is too large. Max upload size is 8GB.' });
    }
    return res.status(400).json({ error: `Upload failed (${err.code}).` });
  }
  return res.status(500).json({ error: 'Unexpected server error while handling upload.' });
});

// ── WebSocket live updates ─────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  send({ type: 'snapshot', captures: store.list() });

  const onUpdate = (capture: Capture) => send({ type: 'update', capture });
  const onRemoved = (id: string) => send({ type: 'removed', id });
  bus.on('update', onUpdate);
  bus.on('removed', onRemoved);

  ws.on('close', () => {
    bus.off('update', onUpdate);
    bus.off('removed', onRemoved);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ◆ Savor server  →  http://localhost:${PORT}`);
  console.log(`    workspace: ${WORKSPACE_DIR}\n`);
});
