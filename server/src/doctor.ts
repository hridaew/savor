import { checkTools, hintFor } from './health';
import { TOOLS, PROJECT_ROOT } from './config';
import { supportsGlobalMapper, supportsAliked } from './tools/colmap';

const ok = (b: boolean) => (b ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m');

const { tools } = await checkTools();
console.log(`\nSavor · pipeline doctor`);
console.log(`project: ${PROJECT_ROOT}\n`);
for (const [name, t] of Object.entries(tools)) {
  console.log(`  ${ok(t.ok)}  ${name.padEnd(8)} ${t.ok ? t.version ?? 'ok' : t.detail ?? 'missing'}`);
  console.log(`     ${'\x1b[2m'}${(t as any).path}\x1b[0m`);
}
console.log();
if (tools.colmap.ok) {
  const [glob, aliked] = await Promise.all([supportsGlobalMapper(), supportsAliked()]);
  const cap = (b: boolean) => (b ? '\x1b[32myes\x1b[0m' : '\x1b[33mno\x1b[0m');
  console.log(
    `  colmap extras · global mapper: ${cap(glob)} · learned features: ${cap(aliked)}  \x1b[2m(COLMAP ≥ 4.x unlocks both)\x1b[0m`,
  );
  console.log();
}
if (!tools.colmap.ok) console.log(`  → install COLMAP:  ${hintFor('colmap')}`);
if (!tools.brush.ok)
  console.log(`  → Brush downloads automatically (npm run setup); expected at ${TOOLS.brush}`);
if (Object.values(tools).every((t) => t.ok)) console.log('  All systems go. Run: npm run dev\n');
