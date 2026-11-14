import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class CapabilityFileError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'CapabilityFileError';
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.inova.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function backupFile(input: { file: string; backupRoot: string }): Promise<void> {
  await mkdir(input.backupRoot, { recursive: true, mode: 0o700 });
  const safeName = input.file.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const digest = createHash('sha1').update(input.file).digest('hex').slice(0, 8);
  try {
    await copyFile(input.file, join(input.backupRoot, `${digest}_${safeName}`));
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function updateJsonFile(input: {
  file: string;
  backupRoot: string;
  update: (root: Record<string, unknown>) => Record<string, unknown>;
}): Promise<void> {
  const raw = await readIfExists(input.file);
  let root: Record<string, unknown> = {};
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CapabilityFileError(input.file, 'invalid JSON');
    }
    if (!isPlainObject(parsed))
      throw new CapabilityFileError(input.file, 'JSON root is not an object');
    root = parsed;
  }
  await backupFile({ file: input.file, backupRoot: input.backupRoot });
  await writeAtomic(input.file, `${JSON.stringify(input.update(root), null, 2)}\n`);
}

const BARE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function tomlTableHeader(segments: readonly string[]): string {
  return segments
    .map((segment) => (BARE_SEGMENT.test(segment) ? segment : JSON.stringify(segment)))
    .join('.');
}

interface Section {
  header: number;
  end: number;
}

function findSection(lines: readonly string[], header: string): Section | null {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !(lines[end] ?? '').trimStart().startsWith('[')) end += 1;
  return { header: start, end };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertKnownTableForm(lines: readonly string[], table: string): void {
  const firstSegment = table.split('.')[0] ?? table;
  const inline = new RegExp(`^\\s*(${escapeRegExp(firstSegment)}|${escapeRegExp(table)})\\s*=`);
  for (const line of lines) {
    if (line.trimStart().startsWith('[')) return;
    if (inline.test(line)) {
      throw new CapabilityFileError(table, 'table defined inline; cannot edit safely');
    }
  }
}

function appendBlock(toml: string, block: string): string {
  if (toml === '') return block;
  const separator = toml.endsWith('\n') ? '\n' : '\n\n';
  return `${toml}${separator}${block}`;
}

export function setTomlTableKey(input: {
  toml: string;
  table: string;
  key: string;
  value: boolean;
}): string {
  const lines = input.toml.split('\n');
  const section = findSection(lines, `[${input.table}]`);
  const assignment = `${input.key} = ${input.value}`;
  if (!section) {
    assertKnownTableForm(lines, input.table);
    return appendBlock(input.toml, `[${input.table}]\n${assignment}\n`);
  }
  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(input.key)}\\s*=`);
  for (let index = section.header + 1; index < section.end; index += 1) {
    const match = keyPattern.exec(lines[index] ?? '');
    if (match) {
      lines[index] = `${match[1] ?? ''}${assignment}`;
      return lines.join('\n');
    }
  }
  lines.splice(section.header + 1, 0, assignment);
  return lines.join('\n');
}

function parseTomlBasicString(file: string, quoted: string): string {
  try {
    const parsed: unknown = JSON.parse(quoted);
    if (typeof parsed === 'string') return parsed;
  } catch {
    throw new CapabilityFileError(file, 'unsupported string escape');
  }
  throw new CapabilityFileError(file, 'invalid string');
}

// REGEX: array body made only of double-quoted strings separated by commas, trailing comma allowed
const QUOTED_ARRAY_BODY = /^\s*(?:"(?:[^"\\]|\\.)*"\s*(?:,\s*"(?:[^"\\]|\\.)*"\s*)*,?\s*)?$/;

function parseQuotedMembers(file: string, items: string): string[] {
  if (!QUOTED_ARRAY_BODY.test(items)) {
    throw new CapabilityFileError(file, 'array has members other than double-quoted strings');
  }
  return [...items.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((match) =>
    parseTomlBasicString(file, match[0]),
  );
}

export function setTomlArrayMembership(input: {
  toml: string;
  table: string;
  key: string;
  member: string;
  present: boolean;
}): string {
  const lines = input.toml.split('\n');
  const section = findSection(lines, `[${input.table}]`);
  const render = (members: readonly string[]): string =>
    `${input.key} = [${members.map((entry) => JSON.stringify(entry)).join(', ')}]`;

  if (!section) {
    if (!input.present) return input.toml;
    assertKnownTableForm(lines, input.table);
    return appendBlock(input.toml, `[${input.table}]\n${render([input.member])}\n`);
  }

  const keyPattern = new RegExp(`^(\\s*)${escapeRegExp(input.key)}\\s*=\\s*(.*)$`);
  for (let index = section.header + 1; index < section.end; index += 1) {
    const match = keyPattern.exec(lines[index] ?? '');
    if (!match) continue;
    const value = (match[2] ?? '').trim();
    const single = /^\[(.*)\]\s*(#.*)?$/.exec(value);
    if (!single) {
      throw new CapabilityFileError(`${input.table}.${input.key}`, 'unsupported array form');
    }
    const members = parseQuotedMembers(input.table, single[1] ?? '');
    const next = members.filter((entry) => entry !== input.member);
    if (input.present) next.push(input.member);
    lines[index] = `${match[1] ?? ''}${render(next)}`;
    return lines.join('\n');
  }

  if (!input.present) return input.toml;
  lines.splice(section.header + 1, 0, render([input.member]));
  return lines.join('\n');
}

const SKILL_CONFIG_HEADER = '[[skills.config]]';

function findSkillConfigBlock(lines: readonly string[], name: string): Section | null {
  const namePattern = /^\s*name\s*=\s*"((?:[^"\\]|\\.)*)"/;
  let cursor = 0;
  while (cursor < lines.length) {
    if ((lines[cursor] ?? '').trim() !== SKILL_CONFIG_HEADER) {
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < lines.length && !(lines[end] ?? '').trimStart().startsWith('[')) end += 1;
    for (let index = cursor + 1; index < end; index += 1) {
      const match = namePattern.exec(lines[index] ?? '');
      if (match && parseTomlBasicString(SKILL_CONFIG_HEADER, `"${match[1] ?? ''}"`) === name) {
        return { header: cursor, end };
      }
    }
    cursor = end;
  }
  return null;
}

export function setTomlSkillConfig(input: {
  toml: string;
  name: string;
  enabled: boolean;
}): string {
  const lines = input.toml.split('\n');
  const block = findSkillConfigBlock(lines, input.name);
  if (input.enabled) {
    if (!block) return input.toml;
    lines.splice(block.header, block.end - block.header);
    return lines.join('\n');
  }
  if (!block) {
    return appendBlock(
      input.toml,
      `${SKILL_CONFIG_HEADER}\nname = ${JSON.stringify(input.name)}\nenabled = false\n`,
    );
  }
  for (let index = block.header + 1; index < block.end; index += 1) {
    const match = /^(\s*)enabled\s*=/.exec(lines[index] ?? '');
    if (match) {
      lines[index] = `${match[1] ?? ''}enabled = false`;
      return lines.join('\n');
    }
  }
  lines.splice(block.header + 1, 0, 'enabled = false');
  return lines.join('\n');
}

export async function updateTomlFile(input: {
  file: string;
  backupRoot: string;
  update: (toml: string) => string;
}): Promise<void> {
  const raw = (await readIfExists(input.file)) ?? '';
  await backupFile({ file: input.file, backupRoot: input.backupRoot });
  await writeAtomic(input.file, input.update(raw));
}

const queueTails = new Map<string, Promise<unknown>>();

export function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queueTails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queueTails.set(key, tail);
  void tail.then(() => {
    if (queueTails.get(key) === tail) queueTails.delete(key);
  });
  return run;
}
