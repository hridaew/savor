import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  /** Called for every chunk (raw), useful for carriage-return progress streams. */
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a process, stream output line-by-line, and resolve when it exits.
 * Rejects (with captured output attached) on non-zero exit.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });

    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';

    const pump = (
      data: Buffer,
      which: 'stdout' | 'stderr',
    ) => {
      const text = data.toString();
      if (which === 'stdout') stdout += text;
      else stderr += text;
      opts.onChunk?.(text, which);

      // split on both \n and \r so progress lines (\r) surface too
      let buf = which === 'stdout' ? outBuf + text : errBuf + text;
      const parts = buf.split(/\r\n|\r|\n/);
      buf = parts.pop() ?? '';
      if (which === 'stdout') outBuf = buf;
      else errBuf = buf;
      for (const line of parts) {
        if (which === 'stdout') opts.onStdout?.(line);
        else opts.onStderr?.(line);
      }
    };

    child.stdout.on('data', (d) => pump(d, 'stdout'));
    child.stderr.on('data', (d) => pump(d, 'stderr'));

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (outBuf && opts.onStdout) opts.onStdout(outBuf);
      if (errBuf && opts.onStderr) opts.onStderr(errBuf);
      if (code === 0) resolvePromise({ code: 0, stdout, stderr });
      else {
        const e: any = new Error(
          `${cmd} exited with code ${code}\n${stderr.slice(-2000)}`,
        );
        e.code = code;
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
      }
    });
  });
}
