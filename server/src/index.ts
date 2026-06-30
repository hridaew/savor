import http from 'node:http';
import { extname, join } from 'node:path';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import express, { type Request } from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { nanoid } from 'nanoid';

import { PORT, WORKSPACE_DIR, SAMPLES_DIR } from './config';
import type { Capture, Quality, ServerMessage } from './types';
import * as store from './store';
import { bus } from './bus';
import { runPipeline } from './pipeline';
import { checkTools } from './health';

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

app.post(
  '/api/captures',
  (req: Request & { jobId?: string }, _res, next) => {
    req.jobId = nanoid(10);
    next();
  },
  upload.single('video'),
  (req: Request & { jobId?: string }, res) => {
    if (!req.file) return res.status(400).json({ error: 'no video uploaded (field "video")' });
    const id = req.jobId!;
    const quality = (['fast', 'balanced', 'high'].includes(req.body?.quality) ? req.body.quality : 'balanced') as Quality;
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
      quality,
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
    previewUrl: undefined,
    splatBytes: undefined,
    gaussians: undefined,
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
