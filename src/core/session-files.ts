import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import type { ChatEvent } from './chat-types.js';
import { tryRunGit } from './git-exec.js';

const PATH_EDIT_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'write_file',
  'write_to_file',
  'edit_file',
  'create_file',
  'replace',
  'replace_file_content',
  'multi_replace_file_content',
  'str_replace_editor',
  'str_replace_based_edit_tool',
  'writefile',
  'strreplacefile',
  'file_change',
]);
const PATCH_TOOLS = new Set(['apply_patch', 'patch']);
const PATH_KEYS = [
  'file_path',
  'filePath',
  'notebook_path',
  'absolute_path',
  'target_file',
  'TargetFile',
  'path',
  'Path',
] as const;
const PATCH_KEYS = ['patch', 'patchText', 'patch_text', 'input'] as const;
// REGEX: captures the target path of apply_patch headers ("*** Update File: x", "*** Move to: y") and unified diff "+++ b/x" lines.
const PATCH_PATH_PATTERN =
  /^(?:\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)|\+\+\+ b\/(.+)|--- a\/(.+))$/gm;

export interface RepoPathRoot {
  dir: string;
  prefix: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pathsFromPatch(patch: string): string[] {
  return [...patch.matchAll(PATCH_PATH_PATTERN)].flatMap((match) => {
    const path = nonEmptyString(match[1] ?? match[2] ?? match[3]);
    return path === null ? [] : [path];
  });
}

function pathsFromRecord(record: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of PATH_KEYS) {
    const path = nonEmptyString(record[key]);
    if (path !== null) {
      paths.push(path);
      break;
    }
  }
  const changes = record['changes'];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      const path = isRecord(change) ? nonEmptyString(change['path']) : null;
      if (path !== null) paths.push(path);
    }
  }
  return paths;
}

function pathsFromToolUse(name: string, input: string): string[] {
  const normalizedName = name.trim().toLowerCase();
  const parsed = parseJson(input);
  if (PATH_EDIT_TOOLS.has(normalizedName)) {
    return isRecord(parsed) ? pathsFromRecord(parsed) : [];
  }
  if (!PATCH_TOOLS.has(normalizedName)) return [];
  if (typeof parsed === 'string') return pathsFromPatch(parsed);
  if (!isRecord(parsed)) return pathsFromPatch(input);
  for (const key of PATCH_KEYS) {
    const patch = nonEmptyString(parsed[key]);
    if (patch !== null) return pathsFromPatch(patch);
  }
  return [];
}

export function extractEditedPaths(events: readonly ChatEvent[]): string[] {
  const paths = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'tool-use') continue;
    for (const path of pathsFromToolUse(event.name, event.input)) paths.add(path);
  }
  return [...paths];
}

function insideRoot(root: RepoPathRoot, absolutePath: string): string | null {
  const rel = relative(root.dir, absolutePath);
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null;
  return posix.join(root.prefix, rel.split(sep).join('/'));
}

export function toRepoRelativePaths(input: {
  paths: readonly string[];
  cwd: string;
  roots: readonly RepoPathRoot[];
}): string[] {
  const result = new Set<string>();
  for (const path of input.paths) {
    const absolutePath = isAbsolute(path) ? path : resolve(input.cwd, path);
    for (const root of input.roots) {
      const repoPath = insideRoot(root, absolutePath);
      if (repoPath !== null) {
        result.add(repoPath);
        break;
      }
    }
  }
  return [...result];
}

async function realpathOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

export async function sessionEditedRepoPaths(input: {
  cwd: string;
  events: readonly ChatEvent[];
}): Promise<string[]> {
  const paths = extractEditedPaths(input.events);
  if (paths.length === 0) return [];
  const [toplevel, prefix] = await Promise.all([
    tryRunGit({ cwd: input.cwd, args: ['rev-parse', '--show-toplevel'] }),
    tryRunGit({ cwd: input.cwd, args: ['rev-parse', '--show-prefix'] }),
  ]);
  if (!toplevel.ok || !prefix.ok) return [];
  const repoDir = toplevel.stdout.trim();
  const cwdPrefix = prefix.stdout.trim();
  const [realCwd, realRepoDir] = await Promise.all([
    realpathOrSelf(input.cwd),
    realpathOrSelf(repoDir),
  ]);
  return toRepoRelativePaths({
    paths,
    cwd: input.cwd,
    roots: [
      { dir: input.cwd, prefix: cwdPrefix },
      { dir: realCwd, prefix: cwdPrefix },
      { dir: repoDir, prefix: '' },
      { dir: realRepoDir, prefix: '' },
    ],
  });
}
