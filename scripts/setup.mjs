#!/usr/bin/env node
// Savor setup: fetch the right Brush binary for this machine and check the
// other tools. Cross-platform (macOS Apple Silicon, Windows x64, Linux x64).
// Run with: npm run setup
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRUSH_VERSION = 'v0.3.0';
const c = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const BRUSH = {
  'darwin-arm64': { asset: 'brush-app-aarch64-apple-darwin.tar.xz', dir: 'brush-app-aarch64-apple-darwin', exe: 'brush_app' },
  'linux-x64': { asset: 'brush-app-x86_64-unknown-linux-gnu.tar.xz', dir: 'brush-app-x86_64-unknown-linux-gnu', exe: 'brush_app' },
  'win32-x64': { asset: 'brush-app-x86_64-pc-windows-msvc.zip', dir: 'brush-app-x86_64-pc-windows-msvc', exe: 'brush_app.exe' },
};

const INSTALL = {
  darwin: { ffmpeg: 'brew install ffmpeg', colmap: 'brew install colmap' },
  linux: { ffmpeg: 'sudo apt-get install -y ffmpeg', colmap: 'sudo apt-get install -y colmap' },
  win32: { ffmpeg: 'winget install Gyan.FFmpeg', colmap: 'download from https://colmap.github.io/install.html' },
};

function onPath(cmd) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [cmd], { stdio: 'ignore' }).status === 0;
}

async function getBrush() {
  const key = `${process.platform}-${process.arch}`;
  const m = BRUSH[key];
  const brushDir = join(ROOT, 'tools', 'brush');

  if (!m) {
    console.log(c.y(`\n  !  No prebuilt Brush for ${key}.`));
    console.log(c.d(`     Build it from source: https://github.com/ArthurBrussee/brush`));
    console.log(c.d(`     Then set BRUSH_BIN=/path/to/brush_app`));
    return false;
  }

  const binPath = join(brushDir, m.dir, m.exe);
  if (existsSync(binPath)) {
    console.log(`  ${c.g('✓')}  Brush ready ${c.d('(' + m.dir + ')')}`);
    return true;
  }

  mkdirSync(brushDir, { recursive: true });
  const url = `https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/${m.asset}`;
  const archive = join(brushDir, m.asset);
  process.stdout.write(`  …  Downloading Brush ${BRUSH_VERSION} for ${key} `);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    console.log(c.g('done'));
  } catch (e) {
    console.log(c.r('failed'));
    console.log(c.d(`     ${e.message} — download manually from:\n     ${url}`));
    return false;
  }

  let extracted = false;
  if (process.platform === 'win32' && m.asset.endsWith('.zip')) {
    // GNU tar (often first on PATH via Git) misreads `E:\…` as a remote
    // host spec; PowerShell's Expand-Archive has no such failure mode.
    // The zip is flat, so extract straight into the per-platform dir.
    const dest = join(brushDir, m.dir);
    mkdirSync(dest, { recursive: true });
    const psq = (s) => `'${s.replace(/'/g, "''")}'`;
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${psq(archive)} -DestinationPath ${psq(dest)} -Force`,
      ],
      { stdio: 'inherit' },
    );
    extracted = ps.status === 0;
    // A future zip may gain a top-level folder; flatten it if so.
    const nested = join(dest, m.dir);
    if (extracted && !existsSync(binPath) && existsSync(join(nested, m.exe))) {
      for (const entry of readdirSync(nested)) {
        renameSync(join(nested, entry), join(dest, entry));
      }
      rmSync(nested, { recursive: true, force: true });
    }
  } else {
    // tar (bsdtar on macOS, GNU tar on Linux) extracts the .tar.xz assets,
    // which carry their own top-level per-platform folder.
    const ex = spawnSync('tar', ['-xf', archive, '-C', brushDir], { stdio: 'inherit' });
    extracted = ex.status === 0;
  }
  if (!extracted) {
    console.log(c.r(`  ✗  Could not extract ${m.asset}.`));
    return false;
  }
  if (!existsSync(binPath)) {
    console.log(c.r(`  ✗  Extracted ${m.asset}, but ${m.exe} was not where expected.`));
    return false;
  }
  rmSync(archive, { force: true });

  if (process.platform === 'darwin') {
    // Ad-hoc sign + clear quarantine so Gatekeeper doesn't kill the binary.
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', binPath], { stdio: 'ignore' });
    spawnSync('codesign', ['--force', '--sign', '-', binPath], { stdio: 'ignore' });
  } else if (process.platform === 'linux') {
    spawnSync('chmod', ['+x', binPath], { stdio: 'ignore' });
  }
  console.log(`  ${c.g('✓')}  Brush installed ${c.d('→ tools/brush/' + m.dir)}`);
  return true;
}

function checkTool(name) {
  const ok = onPath(name);
  const hint = INSTALL[process.platform]?.[name];
  if (ok) {
    console.log(`  ${c.g('✓')}  ${name}`);
  } else {
    console.log(`  ${c.r('✗')}  ${name} ${c.d('not found')}`);
    if (hint) console.log(c.d(`     → ${hint}`));
  }
  return ok;
}

console.log(c.b('\n  Savor setup\n'));
const brushOk = await getBrush();
console.log('');
const ffmpegOk = checkTool('ffmpeg');
const colmapOk = checkTool('colmap');

console.log('');
if (brushOk && ffmpegOk && colmapOk) {
  console.log(c.g('  All set.') + ` Start the app with:  ${c.b('npm run dev')}\n`);
} else {
  console.log(c.y('  Install the missing tools above, then re-run:  ') + c.b('npm run setup\n'));
  process.exitCode = 1;
}
