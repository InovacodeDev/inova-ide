import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fallbackCommandDescription, parseMarkdownCommand, parseTomlStrings } from '../commands.js';
import { containsSecretLiteral, containsSecretShape } from './credential-detect.js';
import {
  commitLibraryDirectory,
  MAX_SCANNED_FILE_BYTES,
  MAX_SKILL_FILE_BYTES,
  parseSkillFrontMatter,
  SKILL_FILE,
  SkillValidationError,
  validateSkillMarkdown,
} from './skills.js';
import { loadLibrary, pluginDir, saveLibraryItem, skillDir } from './store.js';
import type {
  PluginLibraryItem,
  PluginManifestFormat,
  PluginPackageCommandMeta,
  PluginPackageSkillMeta,
  SkillLibraryItem,
} from './types.js';
import { isLibraryId } from './validate.js';
import {
  extractZipEntries,
  MAX_ZIP_DEPTH,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TOTAL_BYTES,
  stripCommonZipRoot,
  type ZipFileEntry,
} from './zip.js';

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_MCP_SERVERS = 50;

const MANIFEST_LOCATIONS: readonly { path: string; format: PluginManifestFormat }[] = [
  { path: '.claude-plugin/plugin.json', format: 'claude' },
  { path: '.codex-plugin/plugin.json', format: 'codex' },
  { path: '.cursor-plugin/plugin.json', format: 'cursor' },
  { path: '.antigravity-plugin/plugin.json', format: 'antigravity' },
  { path: 'plugin.json', format: 'antigravity' },
  { path: 'gemini-extension.json', format: 'antigravity' },
];

export class ZipImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipImportError';
  }
}

export type ZipImportResult =
  | { kind: 'skill'; item: SkillLibraryItem; replaced: boolean }
  | { kind: 'plugin'; item: PluginLibraryItem; replaced: boolean };

interface ParsedPluginManifest {
  format: PluginManifestFormat;
  name: string | null;
  version?: string;
  description: string | null;
  skillPaths: string[];
  commandPaths: string[];
  mcpPaths: string[];
  inlineMcpServers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength).trim();
}

function fileStem(fileName: string | undefined): string {
  if (!fileName) return '';
  return basename(fileName).replace(/\.zip$/i, '');
}

export function slugifyLibraryId(raw: string): string {
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '');
  return normalized === '' ? 'item' : normalized;
}

function resolveTargetId(input: {
  idOverride?: string;
  preferredName: string | null;
  fileName?: string;
}): string {
  if (input.idOverride !== undefined) {
    if (!isLibraryId(input.idOverride)) {
      throw new ZipImportError(
        'O ID informado deve usar minúsculas, números e hífen (até 64 caracteres).',
      );
    }
    return input.idOverride;
  }
  const candidate = input.preferredName?.trim() || fileStem(input.fileName);
  return slugifyLibraryId(candidate);
}

function normalizeDeclaredPath(raw: string, field: string): string {
  const trimmed = raw.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (
    trimmed === '' ||
    trimmed.startsWith('/') ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new ZipImportError(`Caminho inválido em ${field} no manifesto do plugin: ${raw}`);
  }
  return trimmed;
}

function stringPathList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  const rawList = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
  if (rawList === null || !rawList.every((item): item is string => typeof item === 'string')) {
    throw new ZipImportError(`Campo ${field} inválido no manifesto do plugin.`);
  }
  return rawList.map((item) => normalizeDeclaredPath(item, field));
}

function validateTextSafety(value: string, label: string): string {
  if (containsSecretLiteral(value)) {
    throw new ZipImportError(`${label} não pode conter segredos.`);
  }
  return value;
}

function assertPackageEntriesSafe(entries: readonly ZipFileEntry[]): void {
  for (const entry of entries) {
    if (entry.data.length > MAX_SCANNED_FILE_BYTES) continue;
    if (entry.data.includes(0)) continue;
    const text = entry.data.toString('utf8');
    if (containsSecretShape(text)) {
      throw new ZipImportError(`O arquivo ${entry.path} contém formato de segredo.`);
    }
  }
}

async function writeZipEntries(entries: readonly ZipFileEntry[], dest: string): Promise<void> {
  for (const entry of entries) {
    const target = join(dest, ...entry.path.split('/'));
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.data, { mode: entry.executable ? 0o700 : 0o600 });
  }
}

function assertRecordValuesSafe(value: unknown, context: string): void {
  if (typeof value === 'string') {
    if (containsSecretShape(value) || containsSecretLiteral(value)) {
      throw new ZipImportError(`Configuração MCP ${context} contém segredo literal.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => assertRecordValuesSafe(item, `${context}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertRecordValuesSafe(entry, `${context}.${key}`);
    }
  }
}

function parseMcpServerNames(
  entries: readonly ZipFileEntry[],
  extraPaths: readonly string[],
): string[] {
  const candidates = new Set(['.mcp.json', 'mcp_config.json', ...extraPaths]);
  const servers = new Set<string>();
  for (const entry of entries) {
    if (!candidates.has(entry.path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.data.toString('utf8'));
    } catch {
      throw new ZipImportError(`JSON inválido em ${entry.path}.`);
    }
    if (!isRecord(parsed)) {
      throw new ZipImportError(`Conteúdo inválido em ${entry.path}.`);
    }
    const rawMap = isRecord(parsed['mcpServers']) ? parsed['mcpServers'] : parsed;
    for (const [name, config] of Object.entries(rawMap)) {
      if (servers.size >= MAX_MCP_SERVERS) break;
      assertRecordValuesSafe(config, `${entry.path}:${name}`);
      servers.add(clipText(name, MAX_NAME_LENGTH));
    }
  }
  return [...servers];
}

function parseManifest(entry: ZipFileEntry, format: PluginManifestFormat): ParsedPluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.data.toString('utf8'));
  } catch {
    throw new ZipImportError(`Manifesto ${entry.path} não possui JSON válido.`);
  }
  if (!isRecord(parsed)) {
    throw new ZipImportError(`Manifesto ${entry.path} deve ser um objeto JSON.`);
  }
  const rawName = parsed['name'];
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    throw new ZipImportError(`Manifesto ${entry.path} precisa do campo "name".`);
  }
  const name = clipText(validateTextSafety(rawName, `${entry.path}.name`), MAX_NAME_LENGTH);
  const rawVersion = parsed['version'];
  const version =
    typeof rawVersion === 'string' && rawVersion.trim() !== ''
      ? clipText(validateTextSafety(rawVersion, `${entry.path}.version`), 64)
      : undefined;
  const rawDescription = parsed['description'];
  const description =
    typeof rawDescription === 'string' && rawDescription.trim() !== ''
      ? clipText(
          validateTextSafety(rawDescription, `${entry.path}.description`),
          MAX_DESCRIPTION_LENGTH,
        )
      : null;

  const skillPaths = stringPathList(parsed['skills'], 'skills');
  const commandPaths = stringPathList(parsed['commands'], 'commands');
  const mcpPaths: string[] = [];
  const inlineMcpServers: string[] = [];
  const rawMcp = parsed['mcpServers'];
  if (typeof rawMcp === 'string' || Array.isArray(rawMcp)) {
    mcpPaths.push(...stringPathList(rawMcp, 'mcpServers'));
  } else if (isRecord(rawMcp)) {
    for (const [serverName, config] of Object.entries(rawMcp)) {
      assertRecordValuesSafe(config, `mcpServers.${serverName}`);
      inlineMcpServers.push(clipText(serverName, MAX_NAME_LENGTH));
    }
  }

  return {
    format,
    name,
    ...(version === undefined ? {} : { version }),
    description,
    skillPaths,
    commandPaths,
    mcpPaths,
    inlineMcpServers,
  };
}

function findManifest(entries: readonly ZipFileEntry[]): ParsedPluginManifest | null {
  for (const candidate of MANIFEST_LOCATIONS) {
    const found = entries.find((entry) => entry.path === candidate.path);
    if (found) return parseManifest(found, candidate.format);
  }
  return null;
}

function collectPluginSkillDirs(
  entries: readonly ZipFileEntry[],
  declaredPaths: readonly string[],
): string[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const dirs = new Set<string>();

  for (const entry of entries) {
    if (!entry.path.startsWith('skills/') || !entry.path.endsWith(`/${SKILL_FILE}`)) continue;
    const dir = entry.path.slice(0, -`/${SKILL_FILE}`.length);
    if (dir.split('/').length === 2) dirs.add(dir);
  }

  for (const declared of declaredPaths) {
    if (declared.endsWith(`/${SKILL_FILE}`)) {
      if (byPath.has(declared)) dirs.add(declared.slice(0, -`/${SKILL_FILE}`.length));
      continue;
    }
    if (byPath.has(`${declared}/${SKILL_FILE}`)) {
      dirs.add(declared);
      continue;
    }
    const prefix = `${declared}/`;
    for (const entry of entries) {
      if (!entry.path.startsWith(prefix) || !entry.path.endsWith(`/${SKILL_FILE}`)) continue;
      const dir = entry.path.slice(0, -`/${SKILL_FILE}`.length);
      if (dir.split('/').length === declared.split('/').length + 1) dirs.add(dir);
    }
  }

  return [...dirs].sort();
}

function extractPluginSkills(
  entries: readonly ZipFileEntry[],
  skillDirs: readonly string[],
): PluginPackageSkillMeta[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const usedIds = new Set<string>();
  const skills: PluginPackageSkillMeta[] = [];

  for (const dir of skillDirs) {
    const skillEntry = byPath.get(`${dir}/${SKILL_FILE}`);
    if (!skillEntry) continue;
    if (skillEntry.data.length > MAX_SKILL_FILE_BYTES) {
      throw new ZipImportError(`${skillEntry.path} excede ${MAX_SKILL_FILE_BYTES} bytes.`);
    }
    const text = skillEntry.data.toString('utf8');
    try {
      validateSkillMarkdown(text);
    } catch (error: unknown) {
      const reason = error instanceof SkillValidationError ? error.message : 'SKILL.md inválido.';
      throw new ZipImportError(`${skillEntry.path}: ${reason}`);
    }
    const parsed = parseSkillFrontMatter(text);
    const id = slugifyLibraryId(parsed.name ?? basename(dir));
    if (usedIds.has(id)) {
      throw new ZipImportError(`Duas skills no plugin geram o mesmo ID "${id}".`);
    }
    usedIds.add(id);
    skills.push({
      id,
      name: clipText(parsed.name ?? basename(dir), MAX_NAME_LENGTH),
      description:
        parsed.description === null ? null : clipText(parsed.description, MAX_DESCRIPTION_LENGTH),
      path: dir,
    });
  }

  return skills;
}

function commandNameFromPackagePath(baseDir: string, filePath: string, extension: string): string {
  const rel = filePath.startsWith(`${baseDir}/`)
    ? filePath.slice(baseDir.length + 1)
    : basename(filePath);
  const withoutExt = rel.endsWith(extension) ? rel.slice(0, -extension.length) : rel;
  return withoutExt.split('/').join(':');
}

function extractPluginCommands(
  entries: readonly ZipFileEntry[],
  declaredPaths: readonly string[],
): PluginPackageCommandMeta[] {
  const commandFiles = new Map<string, { entry: ZipFileEntry; baseDir: string }>();
  const registerDir = (baseDir: string) => {
    const prefix = `${baseDir}/`;
    for (const entry of entries) {
      if (!entry.path.startsWith(prefix)) continue;
      if (entry.path.endsWith('.md') || entry.path.endsWith('.toml')) {
        commandFiles.set(entry.path, { entry, baseDir });
      }
    }
  };

  registerDir('commands');
  for (const declared of declaredPaths) {
    const exact = entries.find((entry) => entry.path === declared);
    if (exact && (exact.path.endsWith('.md') || exact.path.endsWith('.toml'))) {
      commandFiles.set(exact.path, {
        entry: exact,
        baseDir: dirname(declared) === '.' ? '' : dirname(declared),
      });
    } else {
      registerDir(declared);
    }
  }

  const commands: PluginPackageCommandMeta[] = [];
  const seenNames = new Set<string>();
  for (const filePath of [...commandFiles.keys()].sort()) {
    const found = commandFiles.get(filePath);
    if (!found) continue;
    const raw = found.entry.data.toString('utf8');
    if (filePath.endsWith('.toml')) {
      const parsed = parseTomlStrings(raw);
      const prompt = parsed['prompt']?.trim() ?? '';
      if (prompt === '') continue;
      const name = clipText(
        commandNameFromPackagePath(found.baseDir, filePath, '.toml').replace(/\s+/g, '-'),
        MAX_NAME_LENGTH,
      );
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const desc = parsed['description']?.trim() || fallbackCommandDescription(prompt);
      commands.push({
        name,
        description:
          desc === '' ? null : clipText(validateTextSafety(desc, filePath), MAX_DESCRIPTION_LENGTH),
        path: filePath,
      });
      continue;
    }
    const parsed = parseMarkdownCommand(raw);
    if (parsed.body === '') continue;
    const rawName = parsed.name ?? commandNameFromPackagePath(found.baseDir, filePath, '.md');
    const name = clipText(rawName.replace(/\s+/g, '-'), MAX_NAME_LENGTH);
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    commands.push({
      name,
      description:
        parsed.description === ''
          ? null
          : clipText(validateTextSafety(parsed.description, filePath), MAX_DESCRIPTION_LENGTH),
      path: filePath,
    });
  }
  return commands;
}

function hasPluginSkillsFolder(entries: readonly ZipFileEntry[]): boolean {
  return entries.some((entry) => /^skills\/[^/]+\/SKILL\.md$/.test(entry.path));
}

async function importSkillZip(input: {
  root: string;
  entries: readonly ZipFileEntry[];
  fileName?: string;
  idOverride?: string;
  now: () => Date;
}): Promise<ZipImportResult> {
  const skillEntry = input.entries.find((entry) => entry.path === SKILL_FILE);
  if (!skillEntry) {
    throw new ZipImportError('ZIP de skill deve conter SKILL.md na raiz.');
  }
  if (skillEntry.data.length > MAX_SKILL_FILE_BYTES) {
    throw new ZipImportError(`${SKILL_FILE} excede ${MAX_SKILL_FILE_BYTES} bytes.`);
  }
  const markdown = skillEntry.data.toString('utf8');
  try {
    validateSkillMarkdown(markdown);
  } catch (error: unknown) {
    const reason = error instanceof SkillValidationError ? error.message : 'SKILL.md inválido.';
    throw new ZipImportError(reason);
  }
  assertPackageEntriesSafe(input.entries);
  const frontMatter = parseSkillFrontMatter(markdown);
  const id = resolveTargetId({
    ...(input.idOverride === undefined ? {} : { idOverride: input.idOverride }),
    preferredName: frontMatter.name,
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
  });

  const library = await loadLibrary(input.root);
  const existing = library.items.find((item) => item.id === id);
  if (existing && existing.kind !== 'skill') {
    throw new ZipImportError(`Já existe um item "${id}" do tipo ${existing.kind} na biblioteca.`);
  }

  const { hash, replaced } = await commitLibraryDirectory({
    root: input.root,
    target: skillDir(input.root, id),
    backupSubdir: 'skills',
    id,
    now: input.now,
    populate: (staged) => writeZipEntries(input.entries, staged),
  });

  const saved = await saveLibraryItem({
    root: input.root,
    now: input.now,
    item: {
      id,
      kind: 'skill',
      name: clipText(frontMatter.name ?? id, MAX_NAME_LENGTH),
      description:
        frontMatter.description === null
          ? null
          : clipText(frontMatter.description, MAX_DESCRIPTION_LENGTH),
      enabled: existing?.enabled ?? true,
      source: 'imported',
      definition: { hash },
      updatedAt: input.now().toISOString(),
    },
  });
  return { kind: 'skill', item: saved as SkillLibraryItem, replaced };
}

async function importPluginZip(input: {
  root: string;
  entries: readonly ZipFileEntry[];
  manifest: ParsedPluginManifest | null;
  fileName?: string;
  idOverride?: string;
  now: () => Date;
}): Promise<ZipImportResult> {
  const { manifest, entries } = input;
  assertPackageEntriesSafe(entries);

  const skillDirs = collectPluginSkillDirs(entries, manifest?.skillPaths ?? []);
  const skills = extractPluginSkills(entries, skillDirs);
  const commands = extractPluginCommands(entries, manifest?.commandPaths ?? []);
  const mcpServers = [
    ...new Set([
      ...(manifest?.inlineMcpServers ?? []),
      ...parseMcpServerNames(entries, manifest?.mcpPaths ?? []),
    ]),
  ];

  if (!manifest && skills.length === 0 && commands.length === 0) {
    throw new ZipImportError(
      'ZIP de plugin deve conter um manifesto válido (.claude-plugin/plugin.json, .codex-plugin/plugin.json, .cursor-plugin/plugin.json, plugin.json) ou skills.',
    );
  }

  const id = resolveTargetId({
    ...(input.idOverride === undefined ? {} : { idOverride: input.idOverride }),
    preferredName: manifest?.name ?? null,
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
  });

  const library = await loadLibrary(input.root);
  const existing = library.items.find((item) => item.id === id);
  if (existing && existing.kind !== 'plugin') {
    throw new ZipImportError(`Já existe um item "${id}" do tipo ${existing.kind} na biblioteca.`);
  }

  const { hash, replaced } = await commitLibraryDirectory({
    root: input.root,
    target: pluginDir(input.root, id),
    backupSubdir: 'plugins',
    id,
    now: input.now,
    limits: {
      maxFiles: MAX_ZIP_ENTRIES,
      maxTotalBytes: MAX_ZIP_TOTAL_BYTES,
      maxDepth: MAX_ZIP_DEPTH,
    },
    populate: (staged) => writeZipEntries(entries, staged),
  });

  const saved = await saveLibraryItem({
    root: input.root,
    now: input.now,
    item: {
      id,
      kind: 'plugin',
      name: clipText(manifest?.name ?? id, MAX_NAME_LENGTH),
      description: manifest?.description ?? null,
      enabled: existing?.enabled ?? true,
      source: 'imported',
      definition: {
        format: 'package',
        manifestFormat: manifest?.format ?? 'generic',
        ...(manifest?.version === undefined ? {} : { version: manifest.version }),
        hash,
        skills,
        commands,
        ...(mcpServers.length === 0 ? {} : { mcpServers }),
      },
      updatedAt: input.now().toISOString(),
    },
  });
  return { kind: 'plugin', item: saved as PluginLibraryItem, replaced };
}

export async function importLibraryZip(input: {
  root: string;
  buffer: Buffer;
  fileName?: string;
  expectedKind?: 'skill' | 'plugin';
  idOverride?: string;
  now?: () => Date;
}): Promise<ZipImportResult> {
  const now = input.now ?? (() => new Date());
  const rawEntries = extractZipEntries(input.buffer);
  const entries = stripCommonZipRoot(rawEntries);
  if (entries.length === 0) {
    throw new ZipImportError('O arquivo ZIP está vazio.');
  }

  const manifest = findManifest(entries);
  const hasRootSkill = entries.some((entry) => entry.path === SKILL_FILE);
  const looksLikePlugin = manifest !== null || (!hasRootSkill && hasPluginSkillsFolder(entries));

  if (looksLikePlugin) {
    if (input.expectedKind === 'skill') {
      throw new ZipImportError('O ZIP selecionado é um plugin, não uma skill isolada.');
    }
    return importPluginZip({
      root: input.root,
      entries,
      manifest,
      ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      ...(input.idOverride === undefined ? {} : { idOverride: input.idOverride }),
      now,
    });
  }

  if (hasRootSkill) {
    if (input.expectedKind === 'plugin') {
      throw new ZipImportError('O ZIP selecionado é uma skill, não um plugin.');
    }
    return importSkillZip({
      root: input.root,
      entries,
      ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      ...(input.idOverride === undefined ? {} : { idOverride: input.idOverride }),
      now,
    });
  }

  throw new ZipImportError(
    'Formato ZIP não reconhecido. Use SKILL.md na raiz (skill) ou manifesto padrão de plugin (.claude-plugin/plugin.json, .codex-plugin/plugin.json, .cursor-plugin/plugin.json, plugin.json).',
  );
}
