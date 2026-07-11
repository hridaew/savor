// Re-clean an existing capture's splat (no COLMAP/Brush re-run): regenerates
// scene.ply, scene-hq.ply, and scene.sog with the current cleaner, camera-aware,
// and patches meta.json. Usage:
//   npx tsx server/scripts/clean-capture.ts <id> [--sample]
// --sample also refreshes the bundled samples/sample-scene.ply.
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSplat } from '../src/tools/splatClean';
import { readCameraPoses } from '../src/tools/colmap';
import { convertPlyToSog } from '../src/tools/sog';
import { PIPELINE } from '../src/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const id = process.argv[2];
if (!id) {
  console.error('usage: clean-capture <captureId> [--sample]');
  process.exit(1);
}
const refreshSample = process.argv.includes('--sample');

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
const sceneHqPath = join(outDir, 'scene-hq.ply');

const poses = await readCameraPoses(join(dir, 'sparse', '0'));

const t0 = Date.now();
const r = await cleanSplat(raw, scenePath, {
  cameraCenters: poses?.centers,
  sceneHqPath: PIPELINE.keepShOutputs ? sceneHqPath : undefined,
});
console.log(
  `plane=${r.planeFound}  floaters=${r.floaters}  haze=${r.hazeRemoved}  ` +
    `scene=${r.sceneKept}/${r.total}  radius=${r.radius.toFixed(3)}  ` +
    `env=${r.isEnvironment}  (${Date.now() - t0}ms)`,
);

let beautyPath: string | undefined = PIPELINE.keepShOutputs ? sceneHqPath : undefined;
let beautyBytes = r.sceneBytesHq;
if (PIPELINE.exportSog && PIPELINE.keepShOutputs) {
  const sogPath = join(outDir, 'scene.sog');
  if (await convertPlyToSog(sceneHqPath, sogPath, { onLog: (l) => console.log(l) })) {
    beautyPath = sogPath;
    beautyBytes = (await stat(sogPath)).size;
  }
}

const metaPath = join(dir, 'meta.json');
const meta = JSON.parse(await readFile(metaPath, 'utf8'));
const v = (meta.steps || 1) + (Date.now() % 1000);
meta.splatUrl = `/files/${id}/output/scene.ply?v=${v}`;
meta.splatHqUrl = beautyPath
  ? `/files/${id}/output/${beautyPath.split(/[\\/]/).pop()}?v=${v}`
  : undefined;
meta.fullSplatUrl = undefined;
meta.fullSplatHqUrl = undefined;
meta.gaussians = r.sceneKept;
meta.splatBytes = r.sceneBytes;
meta.splatBytesHq = beautyBytes;
meta.kind = r.isEnvironment ? 'environment' : 'object';
if (r.isEnvironment) {
  meta.envCamPos = r.camPos;
  meta.envCamDir = poses?.medianDir;
  meta.orbitRadius = undefined;
  meta.orbitHeight = undefined;
} else {
  meta.orbitRadius = r.orbitRadius > 0 ? r.orbitRadius : undefined;
  meta.orbitHeight = r.orbitRadius > 0 ? r.orbitHeight : undefined;
}
// Force the poster to regenerate against the recleaned splat.
meta.posterUrl = undefined;
await writeFile(metaPath, JSON.stringify(meta, null, 2));
console.log('patched meta.json (poster will regenerate)');

if (refreshSample) {
  await copyFile(scenePath, join(ROOT, 'samples', 'sample-scene.ply'));
  console.log('refreshed samples/sample-scene.ply');
}
