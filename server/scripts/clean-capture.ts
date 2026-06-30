// Re-clean an existing capture's splat (no COLMAP/Brush re-run) and refresh the
// bundled sample. Usage: npx tsx server/scripts/clean-capture.ts <id> [distMul]
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSplat } from '../src/tools/splatClean';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const id = process.argv[2];
if (!id) {
  console.error('usage: clean-capture <captureId> [distMul]');
  process.exit(1);
}
const distMul = process.argv[3] ? Number(process.argv[3]) : undefined;

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
const cleanPath = join(outDir, 'clean.ply');
const scenePath = join(outDir, 'scene.ply');

const r = await cleanSplat(raw, cleanPath, scenePath, distMul ? { distMul } : {});
console.log(
  `center [${r.center.map((x) => x.toFixed(2)).join(', ')}]  radius ${r.radius.toFixed(3)}  ` +
    `kept ${r.kept}/${r.total} (removed ${r.total - r.kept}, ${((1 - r.kept / r.total) * 100).toFixed(1)}%)`,
);

const metaPath = join(dir, 'meta.json');
const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const v = meta.steps || 1;
meta.splatUrl = `/files/${id}/output/clean.ply?v=${v}`;
meta.fullSplatUrl = `/files/${id}/output/scene.ply?v=${v}`;
meta.gaussians = r.kept;
meta.gaussiansFull = r.total;
meta.splatBytes = r.cleanBytes;
await writeFile(metaPath, JSON.stringify(meta, null, 2));

await copyFile(cleanPath, join(ROOT, 'samples', 'sample.ply'));
await copyFile(scenePath, join(ROOT, 'samples', 'sample-scene.ply'));
console.log('patched meta.json + refreshed samples/sample.ply (+ sample-scene.ply)');
