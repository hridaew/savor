// Re-clean an existing capture's splat (no COLMAP/Brush re-run) and refresh the
// bundled sample. Usage: npx tsx server/scripts/clean-capture.ts <id>
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSplat } from '../src/tools/splatClean';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const id = process.argv[2];
if (!id) {
  console.error('usage: clean-capture <captureId>');
  process.exit(1);
}

const dir = join(ROOT, 'workspace', id);
const outDir = join(dir, 'output');
const raws = readdirSync(outDir)
  .filter((f) => /^splat_\d+\.ply$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
if (!raws.length) {
  console.error('no raw splat_*.ply in', outDir);
  process.exit(1);
}
const raw = join(outDir, raws[raws.length - 1]);
const scenePath = join(outDir, 'scene.ply');

const t0 = Date.now();
const r = await cleanSplat(raw, scenePath);
console.log(
  `plane=${r.planeFound}  floaters=${r.floaters}  haze=${r.hazeRemoved}  ` +
    `scene=${r.sceneKept}/${r.total}  radius=${r.radius.toFixed(3)}  (${Date.now() - t0}ms)`,
);

const metaPath = join(dir, 'meta.json');
const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const v = (meta.steps || 1) + (Date.now() % 1000);
meta.splatUrl = `/files/${id}/output/scene.ply?v=${v}`;
meta.fullSplatUrl = undefined;
meta.gaussians = r.sceneKept;
meta.splatBytes = r.sceneBytes;
await writeFile(metaPath, JSON.stringify(meta, null, 2));

await copyFile(scenePath, join(ROOT, 'samples', 'sample-scene.ply'));
console.log('patched meta.json + refreshed samples/sample-scene.ply');
