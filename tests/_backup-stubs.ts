/**
 * Shared harness for the backup shell-script tests: a temp dir of stub
 * executables (pg_dump, psql, ...) that go on PATH ahead of the real ones, so no
 * test ever touches a real database, GPG key or remote. Every stub appends its
 * command line to $STUB_LOG.
 */
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const repoRoot = path.resolve(import.meta.dirname, '..');

export function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function hasCommand(cmd: string): boolean {
  return spawnSync('bash', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

export function writeStub(binDir: string, name: string, body: string): void {
  mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  writeFileSync(file, `#!/usr/bin/env bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  chmodSync(file, 0o755);
}

// Names the stubs that count as "a database command" for refusal assertions.
export const DB_STUBS = ['psql', 'pg_restore', 'createdb', 'dropdb', 'pg_dump'];

export function stubEnv(binDir: string, logFile: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, STUB_LOG: logFile, ...extra };
}

export function runScript(script: string, args: string[], env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return spawnSync('bash', [path.join(repoRoot, script), ...args], { env, encoding: 'utf8' });
}

export function startScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('bash', [path.join(repoRoot, script), ...args], { env, stdio: 'ignore' });
  const done = new Promise<number | null>((resolve) => child.on('close', resolve));
  return { child, done };
}

/** Local-time `fp_YYYYMMDD_HHMMSS` stamp for a dump made `hoursAgo` hours ago. */
export function dumpStamp(hoursAgo: number): string {
  const d = new Date(Date.now() - hoursAgo * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
