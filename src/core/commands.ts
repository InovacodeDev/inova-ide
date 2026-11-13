import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

export type ProjectCommandSource = 'claude' | 'codex' | 'gemini';
export type ProjectCommandKind = 'command' | 'skill';

export interface ProjectCommand {
  name: string;
  description: string;
  source: ProjectCommandSource;
  kind: ProjectCommandKind;
  body: string;
}

const MAX_DESCRIPTION_CHARS = 120;

// REGEX: match YAML frontmatter delimited by --- at the start of a markdown file
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
// REGEX: match key: value lines in frontmatter
const FRONTMATTER_KV = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
// REGEX: match TOML key = multiline or single-line string value
const TOML_KEY_PATTERN = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/;

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripHeadingPrefix(line: string): string {
  return line.replace(/^#+\s*/, '').trim();
}

function fallbackDescription(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const cleaned = stripHeadingPrefix(line);
    if (cleaned === '') continue;
    return cleaned.length > MAX_DESCRIPTION_CHARS
      ? `${cleaned.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
      : cleaned;
  }
  return '';
}

function parseMarkdownCommand(raw: string): {
  name: string | null;
  description: string;
  body: string;
} {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (!match) {
    const body = raw.trim();
    return { name: null, description: fallbackDescription(body), body };
  }
  const metaBlock = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  let name: string | null = null;
  let description = '';
  for (const line of metaBlock.split(/\r?\n/)) {
    const kv = FRONTMATTER_KV.exec(line.trim());
    if (!kv) continue;
    const key = kv[1];
    const value = unquote(kv[2] ?? '');
    if (key === 'name' && value !== '') name = value;
    if (key === 'description' && value !== '') description = value;
  }
  return {
    name,
    description: description !== '' ? description : fallbackDescription(body),
    body,
  };
}

function parseTomlStrings(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const match = TOML_KEY_PATTERN.exec(line);
    if (!match) continue;
    const key = match[1];
    const rest = (match[2] ?? '').trim();
    if (!key) continue;
    for (const fence of ['"""', "'''"] as const) {
      if (!rest.startsWith(fence)) continue;
      const afterOpen = rest.slice(3);
      const inlineClose = afterOpen.indexOf(fence);
      if (inlineClose >= 0) {
        result[key] = afterOpen.slice(0, inlineClose).trim();
        break;
      }
      const chunks: string[] = afterOpen === '' ? [] : [afterOpen];
      while (i + 1 < lines.length) {
        i += 1;
        const nextLine = lines[i] ?? '';
        const closeIndex = nextLine.indexOf(fence);
        if (closeIndex >= 0) {
          chunks.push(nextLine.slice(0, closeIndex));
          break;
        }
        chunks.push(nextLine);
      }
      result[key] = chunks.join('\n').trim();
      break;
    }
    if (Object.hasOwn(result, key)) continue;
    if (
      (rest.startsWith('"') && rest.endsWith('"')) ||
      (rest.startsWith("'") && rest.endsWith("'"))
    ) {
      result[key] = rest.slice(1, -1);
    }
  }
  return result;
}

async function readSafeProjectFile(rootReal: string, filePath: string): Promise<string | null> {
  const fileReal = await realpath(filePath).catch(() => null);
  if (fileReal === null || !isInsideRoot(rootReal, fileReal)) return null;
  return readFile(fileReal, 'utf8').catch(() => null);
}

async function collectFiles(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(full, extension)));
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(extension)) {
      results.push(full);
    }
  }
  return results;
}

function commandNameFromRel(baseDir: string, filePath: string, extension: string): string {
  const rel = relative(baseDir, filePath).slice(0, -extension.length);
  return rel.split(sep).join(':');
}

async function loadMarkdownCommands(input: {
  rootReal: string;
  baseDir: string;
  source: ProjectCommandSource;
}): Promise<ProjectCommand[]> {
  const files = await collectFiles(input.baseDir, '.md');
  const items: ProjectCommand[] = [];
  for (const file of files) {
    const raw = await readSafeProjectFile(input.rootReal, file);
    if (raw === null) continue;
    const parsed = parseMarkdownCommand(raw);
    if (parsed.body === '') continue;
    items.push({
      name: parsed.name ?? commandNameFromRel(input.baseDir, file, '.md'),
      description: parsed.description,
      source: input.source,
      kind: 'command',
      body: parsed.body,
    });
  }
  return items;
}

async function loadSkills(input: {
  rootReal: string;
  skillsDir: string;
  source: ProjectCommandSource;
}): Promise<ProjectCommand[]> {
  const entries = await readdir(input.skillsDir, { withFileTypes: true }).catch(() => []);
  const items: ProjectCommand[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const skillDir = join(input.skillsDir, entry.name);
    const skillFile = join(skillDir, 'SKILL.md');
    const raw = await readSafeProjectFile(input.rootReal, skillFile);
    if (raw === null) continue;
    const parsed = parseMarkdownCommand(raw);
    if (parsed.body === '') continue;
    items.push({
      name: parsed.name ?? basename(skillDir),
      description: parsed.description,
      source: input.source,
      kind: 'skill',
      body: parsed.body,
    });
  }
  return items;
}

async function loadGeminiTomlCommands(input: {
  rootReal: string;
  baseDir: string;
}): Promise<ProjectCommand[]> {
  const files = await collectFiles(input.baseDir, '.toml');
  const items: ProjectCommand[] = [];
  for (const file of files) {
    const raw = await readSafeProjectFile(input.rootReal, file);
    if (raw === null) continue;
    const parsed = parseTomlStrings(raw);
    const prompt = parsed['prompt']?.trim() ?? '';
    if (prompt === '') continue;
    const description = parsed['description']?.trim() || fallbackDescription(prompt);
    items.push({
      name: commandNameFromRel(input.baseDir, file, '.toml'),
      description,
      source: 'gemini',
      kind: 'command',
      body: prompt,
    });
  }
  return items;
}

export async function listProjectCommands(projectPath: string): Promise<ProjectCommand[]> {
  const rootReal = await realpath(projectPath).catch(() => null);
  if (rootReal === null) return [];
  const groups = await Promise.all([
    loadMarkdownCommands({
      rootReal,
      baseDir: join(rootReal, '.claude', 'commands'),
      source: 'claude',
    }),
    loadSkills({ rootReal, skillsDir: join(rootReal, '.claude', 'skills'), source: 'claude' }),
    loadSkills({ rootReal, skillsDir: join(rootReal, '.agents', 'skills'), source: 'codex' }),
    loadSkills({ rootReal, skillsDir: join(rootReal, '.gemini', 'skills'), source: 'gemini' }),
    loadGeminiTomlCommands({ rootReal, baseDir: join(rootReal, '.gemini', 'commands') }),
  ]);
  return groups.flat().sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.source.localeCompare(b.source);
  });
}

export { expandCommandPrompt } from './command-prompt.js';
