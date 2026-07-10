// Verify splatClean v3 against real captures: environment must survive,
// haze must go, output must exist. Usage: npx tsx server/scripts/verify-clean.ts
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';
import { cleanSplat } from '../src/tools/splatClean';
import { readCameraCenters } from '../src/tools/colmap';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ids = readdirSync(join(ROOT, 'workspace')).filter((d) =>
  existsSync(join(ROOT, 'workspace', d, 'output')),
);
let failed = false;
for (const id of ids) {
  const out = join(ROOT, 'workspace', id, 'output');
  const raws = readdirSync(out)
    .filter((f) => /^splat_\d+\.ply$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!raws.length) continue;
  const cameraCenters =
    (await readCameraCenters(join(ROOT, 'workspace', id, 'sparse', '0'))) ?? undefined;
  const r = await cleanSplat(join(out, raws[raws.length - 1]), join(out, 'verify-scene.ply'), {
    cameraCenters,
  });
  const keptPct = (100 * r.sceneKept) / r.total;
  const ok = keptPct >= 85 && r.sceneKept > 0 && r.radius > 0;
  console.log(
    `${id}: kept=${r.sceneKept}/${r.total} (${keptPct.toFixed(1)}%) ` +
      `floaters=${r.floaters} haze=${r.hazeRemoved} plane=${r.planeFound} ` +
      `orbitR=${r.orbitRadius.toFixed(2)} ${ok ? 'OK' : 'FAIL: kept<85% or degenerate'}`,
  );
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
