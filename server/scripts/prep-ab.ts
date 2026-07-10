// Clean two checkpoints of a capture for visual A/B in the viewer.
// Usage: npx tsx server/scripts/prep-ab.ts <captureId>
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanSplat } from '../src/tools/splatClean';
import { readCameraCenters } from '../src/tools/colmap';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
if (!id) {
  console.error('usage: prep-ab <captureId>');
  process.exit(1);
}
const out = join(ROOT, 'workspace', id, 'output');
const cameraCenters =
  (await readCameraCenters(join(ROOT, 'workspace', id, 'sparse', '0'))) ?? undefined;
for (const [src, dst] of [
  ['splat_12500.ply', 'ab-12k.ply'],
  ['splat_30000.ply', 'ab-30k.ply'],
] as const) {
  const r = await cleanSplat(join(out, src), join(out, dst), { cameraCenters });
  console.log(`${dst}: kept ${r.sceneKept}/${r.total}, orbitR=${r.orbitRadius.toFixed(2)}`);
  console.log(`  http://localhost:8787/files/${id}/output/${dst}`);
}
