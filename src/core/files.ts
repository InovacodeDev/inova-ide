import { execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_FILES = 50_000;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const IGNORED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);

export interface ProjectFileList {
  files: string[];
  truncated: boolean;
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

async function listViaGit(projectPath: string, maxFiles: number): Promise<ProjectFileList | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectPath, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { maxBuffer: GIT_MAX_BUFFER, timeout: GIT_TIMEOUT_MS },
    );
    const files: string[] = [];
    let truncated = false;
    for (const raw of stdout.split('\0')) {
      if (raw === '') continue;
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push(toPosix(raw));
    }
    files.sort((a, b) => a.localeCompare(b));
    return { files, truncated };
  } catch {
    return null;
  }
}

async function walkProjectFiles(projectPath: string, maxFiles: number): Promise<ProjectFileList> {
  const rootReal = await realpath(projectPath);
  const files: string[] = [];
  let truncated = false;
  const queue: string[] = [rootReal];

  while (queue.length > 0 && !truncated) {
    const current = queue.shift();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        queue.push(join(current, entry.name));
        continue;
      }
      if (entry.isSymbolicLink()) {
        const target = await realpath(join(current, entry.name)).catch(() => null);
        if (target === null || !isInsideRoot(rootReal, target)) continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push(toPosix(relative(rootReal, join(current, entry.name))));
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return { files, truncated };
}

export async function listProjectFiles(ctx: {
  projectPath: string;
  maxFiles?: number;
}): Promise<ProjectFileList> {
  const maxFiles = ctx.maxFiles ?? DEFAULT_MAX_FILES;
  const viaGit = await listViaGit(ctx.projectPath, maxFiles);
  if (viaGit !== null) return viaGit;
  return walkProjectFiles(ctx.projectPath, maxFiles);
}

function isSubsequence(target: string, query: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

function scoreFile(path: string, query: string): number {
  const lowerPath = path.toLowerCase();
  const base = basename(lowerPath);
  if (base === query) return 6;
  if (base.startsWith(query)) return 5;
  if (lowerPath.startsWith(query)) return 4;
  if (base.includes(query)) return 3;
  if (lowerPath.includes(query)) return 2;
  if (isSubsequence(lowerPath, query)) return 1;
  return 0;
}

export function rankProjectFiles(files: readonly string[], query: string, limit = 40): string[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return [...files].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  }
  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const score = scoreFile(path, normalized);
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path.length !== b.path.length) return a.path.length - b.path.length;
    return a.path.localeCompare(b.path);
  });
  return scored.slice(0, limit).map((item) => item.path);
}
