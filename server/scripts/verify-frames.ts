// Verify sharpness scoring on a real capture's source video.
// Usage: npx tsx server/scripts/verify-frames.ts <captureId>
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { probe, scoreFrames, pickSharpest } from '../src/tools/ffmpeg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = process.argv[2];
if (!id) {
  console.error('usage: verify-frames <captureId>');
  process.exit(1);
}
const dir = join(ROOT, 'workspace', id);
const src = readdirSync(dir).find((f) => f.startsWith('source.'));
if (!src) throw new Error('no source video');
const info = await probe(join(dir, src));
const scores = await scoreFrames(join(dir, src), info.totalFrames);
const picks = pickSharpest(scores, 150);
const uniform = Array.from({ length: picks.length }, (_, w) =>
  Math.floor((w * scores.length) / picks.length),
);
const avg = (ix: number[]) => ix.reduce((s, i) => s + scores[i], 0) / ix.length;
console.log(`frames scored: ${scores.length}/${info.totalFrames}`);
console.log(
  `picked ${picks.length}; sharpness picked=${avg(picks).toFixed(2)} uniform=${avg(uniform).toFixed(2)}`,
);
const monotonic = picks.every((p, k) => k === 0 || p > picks[k - 1]);
if (!monotonic || avg(picks) < avg(uniform)) {
  console.error('FAIL: picks not monotonic or not sharper than uniform');
  process.exit(1);
}
console.log('OK');
