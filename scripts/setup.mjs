#!/usr/bin/env node
// Savor setup: fetch the right Brush binary for this machine and check the
// other tools. Cross-platform (macOS Apple Silicon, Windows x64, Linux x64).
//
// Modes:
//   node scripts/setup.mjs               interactive report; exit 1 if anything missing
//   node scripts/setup.mjs --auto        best-effort (postinstall/predev); always exit 0
//   node scripts/setup.mjs --brush-only  fetch Brush only; exit code reflects Brush state
//   node scripts/setup.mjs --colmap-only install COLMAP (Windows fetch / macOS brew); exit code reflects it
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRUSH_VERSION = 'v0.3.0';
const AUTO = process.argv.includes('--auto');
const BRUSH_ONLY = process.argv.includes('--brush-only');
const COLMAP_ONLY = process.argv.includes('--colmap-only');

// Official COLMAP prebuilt for Windows (the only platform COLMAP ships a
// self-contained binary for). macOS/Linux install COLMAP from their package
// manager instead — there is no official standalone build to fetch.
const COLMAP_VERSION = '4.1.0';
const COLMAP_WIN = {
  asset: `colmap-x64-windows-nocuda.zip`,
  url: `https://github.com/colmap/colmap/releases/download/${COLMAP_VERSION}/colmap-x64-windows-nocuda.zip`,
};
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

/** Bundled binary from an npm package (ffmpeg-static / ffprobe-static), if installed. */
function bundledBin(pkg, pickPath) {
  try {
    const require = createRequire(join(ROOT, 'package.json'));
    const p = pickPath(require(pkg));
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
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

/** Recursively find a named executable under `dir` (bounded depth). */
function findExe(dir, name, depth = 0) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const direct = entries.find((e) => e.toLowerCase() === name.toLowerCase());
  if (direct) return join(dir, direct);
  if (depth >= 3) return null;
  for (const e of entries) {
    const child = join(dir, e);
    try {
      if (statSync(child).isDirectory()) {
        const hit = findExe(child, name, depth + 1);
        if (hit) return hit;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Is COLMAP available — on PATH (an existing install always wins) or bundled? */
function colmapReady() {
  if (onPath('colmap')) return true;
  if (process.platform === 'win32') {
    return !!findExe(join(ROOT, 'tools', 'colmap'), 'colmap.exe');
  }
  return false;
}

/**
 * Install COLMAP for this platform:
 *   Windows — download + extract the official prebuilt zip into tools/colmap/
 *   macOS   — `brew install colmap` (requires Homebrew)
 *   Linux   — can't auto-install (needs sudo); print the apt command
 * Returns true on success.
 */
async function getColmap() {
  if (colmapReady()) {
    console.log(`  ${c.g('✓')}  COLMAP ready`);
    return true;
  }

  if (process.platform === 'win32') {
    const colmapDir = join(ROOT, 'tools', 'colmap');
    mkdirSync(colmapDir, { recursive: true });
    const archive = join(colmapDir, COLMAP_WIN.asset);
    process.stdout.write(`  …  Downloading COLMAP ${COLMAP_VERSION} for Windows `);
    try {
      const res = await fetch(COLMAP_WIN.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
      console.log(c.g('done'));
    } catch (e) {
      console.log(c.r('failed'));
      console.log(c.d(`     ${e.message} — download manually from:\n     ${COLMAP_WIN.url}`));
      return false;
    }
    const psq = (s) => `'${s.replace(/'/g, "''")}'`;
    const ps = spawnSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath ${psq(archive)} -DestinationPath ${psq(colmapDir)} -Force`,
      ],
      { stdio: 'inherit' },
    );
    if (ps.status !== 0 || !findExe(colmapDir, 'colmap.exe')) {
      console.log(c.r(`  ✗  Extracted COLMAP, but colmap.exe was not found.`));
      return false;
    }
    rmSync(archive, { force: true });
    console.log(`  ${c.g('✓')}  COLMAP installed ${c.d('→ tools/colmap/')}`);
    return true;
  }

  if (process.platform === 'darwin') {
    if (!onPath('brew')) {
      console.log(c.r('  ✗  Homebrew not found.'));
      console.log(c.d('     Install it from https://brew.sh, then: brew install colmap'));
      return false;
    }
    console.log(c.d('  …  Running: brew install colmap  (this can take a few minutes)'));
    const r = spawnSync('brew', ['install', 'colmap'], { stdio: 'inherit' });
    if (r.status === 0 && onPath('colmap')) {
      console.log(`  ${c.g('✓')}  COLMAP installed via Homebrew`);
      return true;
    }
    console.log(c.r('  ✗  brew install colmap did not complete.'));
    return false;
  }

  // Linux: needs sudo — we can't run it for the user.
  console.log(c.y('  !  Install COLMAP with your package manager:'));
  console.log(c.d('     sudo apt-get install -y colmap'));
  return false;
}

function checkFfmpeg() {
  const bundled = bundledBin('ffmpeg-static', (m) => m?.default ?? m);
  const probeBundled = bundledBin('@ffprobe-installer/ffprobe', (m) => m?.path);
  if (bundled && probeBundled) {
    console.log(`  ${c.g('✓')}  ffmpeg ${c.d('(bundled via npm)')}`);
    return true;
  }
  return checkTool('ffmpeg');
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

function colmapHint() {
  if (process.platform === 'darwin') return 'brew install colmap';
  if (process.platform === 'linux') return 'sudo apt-get install -y colmap';
  return 'run: npm run setup';
}

if (BRUSH_ONLY) {
  const ok = await getBrush();
  process.exitCode = ok ? 0 : 1;
} else if (COLMAP_ONLY) {
  const ok = await getColmap();
  process.exitCode = ok ? 0 : 1;
} else {
  console.log(c.b('\n  Savor setup\n'));
  const brushOk = await getBrush();
  // Windows can auto-fetch COLMAP; macOS/Linux only report (installing COLMAP
  // there is a package-manager action the app offers explicitly, not silently).
  if (process.platform === 'win32') await getColmap();
  console.log('');
  const ffmpegOk = checkFfmpeg();
  const colmapOk = colmapReady();
  if (colmapOk) {
    console.log(`  ${c.g('✓')}  colmap`);
  } else {
    console.log(`  ${c.r('✗')}  colmap ${c.d('not found')}`);
    console.log(c.d(`     → ${colmapHint()}`));
  }

  console.log('');
  if (brushOk && ffmpegOk && colmapOk) {
    console.log(c.g('  All set.') + ` Start the app with:  ${c.b('npm run dev')}\n`);
  } else if (AUTO) {
    // Best-effort mode (postinstall/predev): report, but never fail the
    // surrounding npm command — the app guides setup from its own UI too.
    console.log(c.y('  Some tools are missing (see above). The app will point you at'));
    console.log(c.y('  the fix on its setup screen, or re-run:  ') + c.b('npm run setup\n'));
  } else {
    console.log(c.y('  Install the missing tools above, then re-run:  ') + c.b('npm run setup\n'));
    process.exitCode = 1;
  }
}
