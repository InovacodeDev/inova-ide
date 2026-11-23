import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isMissingFile, serialize } from '../capabilities/file-edit.js';
import { createBackupDir, skillDir } from './store.js';
import { containsSecretShape, isLibraryId } from './validate.js';

export const SKILL_MARKER_FILE = '.inova-managed';
export const SKILL_FILE = 'SKILL.md';

export const MAX_SKILL_FILE_BYTES = 256 * 1024;
export const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 5;
const IGNORED_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules', SKILL_MARKER_FILE]);
const OWNER_EXECUTE = 0o100;

// REGEX: front matter block opened and closed by --- lines (LF or CRLF), optional BOM
const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
// REGEX: top-level YAML "key: value" line
const FRONT_MATTER_LINE = /^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/;
// REGEX: YAML block scalar indicator (>, |, >-, |-)
const YAML_BLOCK_SCALAR = /^[>|][+-]?$/;

export class SkillValidationError extends Error {
  constructor(reason: string) {
    super(`Invalid skill: ${reason}`);
    this.name = 'SkillValidationError';
  }
}

export type EnvFilePolicy = 'reject' | 'skip';

interface SkillFile {
  relative: string;
  absolute: string;
  size: number;
  executable: boolean;
}

interface WalkState {
  files: SkillFile[];
  totalBytes: number;
}

export async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function unquote(value: string): string {
  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote);
  return (quoted ? value.slice(1, -1) : value).trim();
}

function parseFrontMatter(content: string): Map<string, string> | null {
  const block = FRONT_MATTER.exec(content)?.[1];
  if (block === undefined) return null;
  const fields = new Map<string, string>();
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const match = FRONT_MATTER_LINE.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    const rawValue = match[2] ?? '';
    const trimmedValue = rawValue.trim();
    if (YAML_BLOCK_SCALAR.test(trimmedValue)) {
      const folded = trimmedValue.startsWith('>');
      const collected: string[] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1] ?? '';
        if (nextLine !== '' && !/^[ \t]/.test(nextLine)) break;
        i += 1;
        const trimmedLine = nextLine.trim();
        if (trimmedLine !== '' || !folded) collected.push(trimmedLine);
      }
      fields.set(key, (folded ? collected.join(' ') : collected.join('\n')).trim());
    } else {
      fields.set(key, unquote(rawValue));
    }
  }
  return fields;
}

export function parseSkillFrontMatter(content: string): {
  name: string | null;
  description: string | null;
  body: string;
} {
  const match = FRONT_MATTER.exec(content);
  if (!match) {
    return { name: null, description: null, body: content.trim() };
  }
  const fields = parseFrontMatter(content);
  const name = fields?.get('name') ?? '';
  const description = fields?.get('description') ?? '';
  return {
    name: name === '' ? null : name,
    description: description === '' ? null : description,
    body: content.slice(match[0].length).trim(),
  };
}

export function validateSkillMarkdown(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) {
    throw new SkillValidationError(`${SKILL_FILE} exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
  }
  const fields = parseFrontMatter(content);
  if (fields === null) {
    throw new SkillValidationError(`${SKILL_FILE} needs a front matter block between --- lines`);
  }
  for (const required of ['name', 'description']) {
    if (!fields.get(required)) {
      throw new SkillValidationError(`${SKILL_FILE} front matter needs a non-empty ${required}`);
    }
  }
  if (containsSecretShape(content)) {
    throw new SkillValidationError(`${SKILL_FILE} must not contain secrets`);
  }
}

function assertSkillId(id: string): void {
  if (!isLibraryId(id)) throw new SkillValidationError('id must be a lowercase slug');
}

async function walkDirectory(input: {
  dir: string;
  relative: string;
  depth: number;
  envPolicy: EnvFilePolicy;
  maxFiles: number;
  maxTotalBytes: number;
  maxDepth: number;
  state: WalkState;
}): Promise<void> {
  const { dir, relative, depth, envPolicy, maxFiles, maxTotalBytes, maxDepth, state } = input;
  if (depth > maxDepth) {
    throw new SkillValidationError(`folder nesting exceeds ${maxDepth} levels`);
  }
  for (const name of (await readdir(dir)).sort()) {
    if (name.includes('\0')) throw new SkillValidationError('entry name contains a null byte');
    if (IGNORED_NAMES.has(name)) continue;
    const entryRelative = relative === '' ? name : `${relative}/${name}`;
    if (name.startsWith('.env')) {
      if (envPolicy === 'reject') {
        throw new SkillValidationError(`refusing environment file: ${entryRelative}`);
      }
      continue;
    }
    const absolute = join(dir, name);
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      throw new SkillValidationError(`symbolic links are not allowed: ${entryRelative}`);
    }
    if (stats.isDirectory()) {
      await walkDirectory({ ...input, dir: absolute, relative: entryRelative, depth: depth + 1 });
      continue;
    }
    if (!stats.isFile()) {
      throw new SkillValidationError(`unsupported entry type: ${entryRelative}`);
    }
    state.totalBytes += stats.size;
    if (state.files.length + 1 > maxFiles || state.totalBytes > maxTotalBytes) {
      throw new SkillValidationError(`folder exceeds ${maxFiles} files or ${maxTotalBytes} bytes`);
    }
    state.files.push({
      relative: entryRelative,
      absolute,
      size: stats.size,
      executable: (stats.mode & OWNER_EXECUTE) !== 0,
    });
  }
}

export async function listSkillFiles(input: {
  dir: string;
  envPolicy: EnvFilePolicy;
  maxFiles?: number;
  maxTotalBytes?: number;
  maxDepth?: number;
}): Promise<SkillFile[]> {
  const root = await lstat(input.dir);
  if (!root.isDirectory()) {
    throw new SkillValidationError(`not a regular folder: ${input.dir}`);
  }
  const state: WalkState = { files: [], totalBytes: 0 };
  await walkDirectory({
    dir: input.dir,
    relative: '',
    depth: 0,
    envPolicy: input.envPolicy,
    maxFiles: input.maxFiles ?? MAX_FILES,
    maxTotalBytes: input.maxTotalBytes ?? MAX_TOTAL_BYTES,
    maxDepth: input.maxDepth ?? MAX_DEPTH,
    state,
  });
  return state.files.sort((a, b) =>
    a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,
  );
}

async function hashSkillFiles(files: readonly SkillFile[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files) {
    const content = await readFile(file.absolute);
    hash.update(`${file.relative}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

export async function hashSkillDir(
  dir: string,
  limits?: { maxFiles?: number; maxTotalBytes?: number; maxDepth?: number },
): Promise<string> {
  return hashSkillFiles(await listSkillFiles({ dir, envPolicy: 'skip', ...limits }));
}

export async function readLibrarySkillHash(dir: string): Promise<string> {
  let files: SkillFile[];
  try {
    files = await listSkillFiles({ dir, envPolicy: 'skip' });
  } catch (error: unknown) {
    if (isMissingFile(error)) throw new SkillValidationError('skill folder is missing');
    throw error;
  }
  if (!files.some((file) => file.relative === SKILL_FILE)) {
    throw new SkillValidationError(`${SKILL_FILE} is missing at the folder root`);
  }
  return hashSkillFiles(files);
}

async function copySkillFiles(input: { files: readonly SkillFile[]; dest: string }): Promise<void> {
  for (const file of input.files) {
    const target = join(input.dest, ...file.relative.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(file.absolute), {
      mode: file.executable ? 0o700 : 0o600,
    });
  }
}

export async function copySkillDir(input: { source: string; dest: string }): Promise<void> {
  const files = await listSkillFiles({ dir: input.source, envPolicy: 'skip' });
  await copySkillFiles({ files, dest: input.dest });
}

export async function backupEntry(input: { source: string; dest: string }): Promise<void> {
  await mkdir(dirname(input.dest), { recursive: true, mode: 0o700 });
  await cp(input.source, input.dest, { recursive: true, verbatimSymlinks: true });
}

export function temporaryEntryName(prefix: string): string {
  return `.tmp-${prefix}${randomUUID()}`;
}

async function discardQuietly(path: string): Promise<void> {
  // NOTE: the replacement is already committed, so a failed cleanup must not undo or hide it
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

export async function replaceEntry(input: {
  staged: string;
  target: string;
  backupTo?: string;
}): Promise<void> {
  const { staged, target, backupTo } = input;
  if ((await lstatIfExists(target)) === null) {
    await rename(staged, target);
    return;
  }
  if (backupTo !== undefined) await backupEntry({ source: target, dest: backupTo });
  const aside = join(dirname(target), temporaryEntryName('old-'));
  await rename(target, aside);
  try {
    await rename(staged, target);
  } catch (error: unknown) {
    await rename(aside, target);
    throw error;
  }
  await discardQuietly(aside);
}

export async function removeEntry(target: string): Promise<void> {
  const aside = join(dirname(target), temporaryEntryName('old-'));
  await rename(target, aside);
  await discardQuietly(aside);
}

export async function commitLibraryDirectory(input: {
  root: string;
  target: string;
  backupSubdir: string;
  id: string;
  now: () => Date;
  limits?: { maxFiles?: number; maxTotalBytes?: number; maxDepth?: number };
  populate: (staged: string) => Promise<void>;
}): Promise<{ hash: string; replaced: boolean }> {
  const { root, target, backupSubdir, id, now, limits, populate } = input;
  return serialize(target, async () => {
    const parentRoot = dirname(target);
    await mkdir(parentRoot, { recursive: true, mode: 0o700 });
    const staged = join(parentRoot, temporaryEntryName(''));
    try {
      await mkdir(staged, { mode: 0o700 });
      await populate(staged);
      const hash = await hashSkillDir(staged, limits);
      const existing = await lstatIfExists(target);
      const backupTo = existing
        ? join(await createBackupDir({ root, at: now() }), backupSubdir, id)
        : undefined;
      await replaceEntry({ staged, target, ...(backupTo ? { backupTo } : {}) });
      return { hash, replaced: existing !== null };
    } catch (error: unknown) {
      await rm(staged, { recursive: true, force: true });
      throw error;
    }
  });
}

async function commitSkill(input: {
  root: string;
  id: string;
  now: () => Date;
  populate: (staged: string) => Promise<void>;
}): Promise<{ hash: string }> {
  const { hash } = await commitLibraryDirectory({
    root: input.root,
    target: skillDir(input.root, input.id),
    backupSubdir: 'skills',
    id: input.id,
    now: input.now,
    populate: input.populate,
  });
  return { hash };
}

export async function installSkillFromText(input: {
  root: string;
  id: string;
  content: string;
  now?: () => Date;
}): Promise<{ hash: string }> {
  const { root, id, content } = input;
  assertSkillId(id);
  validateSkillMarkdown(content);
  return commitSkill({
    root,
    id,
    now: input.now ?? (() => new Date()),
    populate: (staged) => writeFile(join(staged, SKILL_FILE), content, { mode: 0o600 }),
  });
}

async function assertNoSecretsInFiles(files: readonly SkillFile[]): Promise<void> {
  for (const file of files) {
    if (file.relative === SKILL_FILE || file.size > MAX_SCANNED_FILE_BYTES) continue;
    const content = await readFile(file.absolute);
    if (content.includes(0)) continue;
    if (containsSecretShape(content.toString('utf8'))) {
      throw new SkillValidationError(`${file.relative} must not contain secrets`);
    }
  }
}

export async function importSkillFolder(input: {
  root: string;
  id: string;
  sourceDir: string;
  now?: () => Date;
}): Promise<{ hash: string }> {
  const { root, id, sourceDir } = input;
  assertSkillId(id);
  const files = await listSkillFiles({ dir: sourceDir, envPolicy: 'reject' });
  const skillFile = files.find((file) => file.relative === SKILL_FILE);
  if (!skillFile) throw new SkillValidationError(`${SKILL_FILE} is missing at the folder root`);
  if (skillFile.size > MAX_SKILL_FILE_BYTES) {
    throw new SkillValidationError(`${SKILL_FILE} exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
  }
  validateSkillMarkdown(await readFile(skillFile.absolute, 'utf8'));
  await assertNoSecretsInFiles(files);
  return commitSkill({
    root,
    id,
    now: input.now ?? (() => new Date()),
    populate: (staged) => copySkillFiles({ files, dest: staged }),
  });
}
