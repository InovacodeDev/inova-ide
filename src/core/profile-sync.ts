import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  CapabilityFileError,
  listTomlTables,
  readTomlTableKey,
  serialize,
  tomlTableHeader,
  writeAtomic,
} from './capabilities/file-edit.js';
import { parseMcpItems } from './capabilities/gemini.js';
import type { CapabilityRef } from './capabilities/types.js';
import {
  changeManaged,
  emptyManaged,
  loadManaged,
  managedHashesFor,
  managedNamesFor,
  managedTargetKey,
} from './library/managed.js';
import type { ManagedHashes, ManagedRegistry } from './library/managed.js';
import { approvalKey, approvalToken, stableHash } from './library/approval.js';
import type { ApprovalMode } from './library/approval.js';
import {
  codexMcpTablesText,
  codexServerTableText,
  stripCodexServerTables,
} from './library/codex-preserve.js';
import { projectLibraryMcp } from './library/mcp.js';
import {
  removalCandidates,
  removalReason,
  removeAgyServers,
  retainedMcpNames,
  splitRemovalByHash,
  statusWithRemoval,
  withoutJsonServers,
} from './library/mcp-removal.js';
import type { LibraryMcpProjection } from './library/mcp.js';
import { maskUrlSecrets } from './library/mcp-view.js';
import { applySkillEntry, planSkillTargets } from './library/skills-projection.js';
import type { SkillPlanEntry } from './library/skills-projection.js';
import { ConfigParseError, isUnreadableConfigError } from './library/sync-errors.js';
import type { LibraryItem } from './library/types.js';
import type { CommandRunner } from './providers.js';
import type { ProviderId } from './types.js';

export type RulesFile = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';

export type RulesStrategy = 'copy' | 'symlink';

export type ProfileSyncStatus =
  'create' | 'update' | 'unchanged' | 'conflict' | 'incompatible' | 'remove';

export interface McpStdioServer {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHttpServer {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServer | McpHttpServer;

export type CanonicalMcpMap = Record<string, McpServerConfig>;

export interface ProfileSyncAccountInput {
  id: string;
  provider: ProviderId;
  label: string;
  homeDir: string;
  disabledCapabilities?: CapabilityRef[];
}

export interface ProfileSyncLibraryInput {
  items: readonly LibraryItem[];
  projectDisabled: readonly string[];
}

export type ProfileSyncScope = 'mcp' | 'rules' | 'skill';

export interface ProfileSyncItem {
  id: string;
  scope: ProfileSyncScope;
  provider: ProviderId;
  accountId?: string;
  accountLabel?: string;
  targetPath: string;
  status: ProfileSyncStatus;
  reason?: string;
  maskedBefore: string;
  maskedAfter: string;
  approvalKey: string;
}

export interface ProfileSyncPreview {
  mcpSourceExists: boolean;
  mcpServerCount: number;
  rulesSource: RulesFile | null;
  availableRulesFiles: RulesFile[];
  items: ProfileSyncItem[];
}

export interface ProfileSyncApplyResult {
  backupDir: string;
  appliedIds: string[];
  skippedIds: string[];
}

// REGEX: header of the mcp_servers table or of one of its subtables
const MCP_TABLES_PATTERN = /^\s*\[mcp_servers[.\]]/m;

const RULES_FILES: readonly RulesFile[] = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

const ALL_SCOPES: readonly ProfileSyncScope[] = ['mcp', 'rules', 'skill'];

const PROVIDER_RULE_FILE: Partial<Record<ProviderId, RulesFile>> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  opencode: 'AGENTS.md',
  qwen: 'AGENTS.md',
  gemini: 'GEMINI.md',
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function parseServerConfig(raw: unknown): McpServerConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  if ((type === 'http' || type === 'sse') && typeof obj['url'] === 'string') {
    const headers = isStringRecord(obj['headers']) ? obj['headers'] : undefined;
    return { type, url: obj['url'], ...(headers ? { headers } : {}) };
  }
  if (typeof obj['command'] === 'string') {
    const args =
      Array.isArray(obj['args']) && obj['args'].every((item) => typeof item === 'string')
        ? obj['args']
        : undefined;
    const env = isStringRecord(obj['env']) ? obj['env'] : undefined;
    return {
      command: obj['command'],
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
    };
  }
  return null;
}

function extractMcpServersMap(raw: unknown): CanonicalMcpMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const source = obj['mcpServers'];
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return {};
  const result: CanonicalMcpMap = {};
  for (const [name, config] of Object.entries(source)) {
    const parsed = parseServerConfig(config);
    if (parsed) result[name] = parsed;
  }
  return result;
}

export async function readCanonicalMcpConfig(input: {
  projectPath: string;
}): Promise<{ exists: boolean; servers: CanonicalMcpMap }> {
  const raw = await readOptionalFile(join(input.projectPath, '.mcp.json'));
  if (raw === null) return { exists: false, servers: {} };
  try {
    return { exists: true, servers: extractMcpServersMap(JSON.parse(raw)) };
  } catch {
    return { exists: true, servers: {} };
  }
}

async function readAccountMcpConfig(input: {
  account: ProfileSyncAccountInput;
  projectPath: string;
}): Promise<CanonicalMcpMap> {
  const { account, projectPath } = input;
  if (account.provider === 'claude') {
    const raw = await readOptionalFile(join(account.homeDir, '.claude.json'));
    if (!raw) return {};
    return extractMcpServersMap(parseJsonRecord(raw, '.claude.json'));
  }
  if (account.provider === 'qwen') {
    const raw = await readOptionalFile(join(account.homeDir, '.qwen', 'settings.json'));
    if (!raw) return {};
    return extractMcpServersMap(parseJsonRecord(raw, '.qwen/settings.json'));
  }
  if (account.provider === 'gemini') {
    const antigravity = await readOptionalFile(
      join(account.homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
    );
    if (antigravity) return extractMcpServersMap(parseJsonRecord(antigravity, 'mcp_config.json'));
    const settings = await readOptionalFile(join(account.homeDir, '.gemini', 'settings.json'));
    return settings ? extractMcpServersMap(parseJsonRecord(settings, '.gemini/settings.json')) : {};
  }
  if (account.provider === 'opencode') {
    const raw = await readOptionalFile(join(projectPath, 'opencode.json'));
    if (!raw) return {};
    return extractOpencodeServers(parseJsonRecord(raw, 'opencode.json'));
  }
  return {};
}

function objectEntry(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = root[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractOpencodeServers(root: Record<string, unknown>): CanonicalMcpMap {
  const result: CanonicalMcpMap = {};
  for (const [name, entry] of Object.entries(objectEntry(root, 'mcp'))) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    if (item['type'] === 'remote' && typeof item['url'] === 'string') {
      const headers = isStringRecord(item['headers']) ? item['headers'] : undefined;
      result[name] = { type: 'http', url: item['url'], ...(headers ? { headers } : {}) };
    } else if (
      item['type'] === 'local' &&
      Array.isArray(item['command']) &&
      item['command'].length > 0 &&
      item['command'].every((part) => typeof part === 'string')
    ) {
      const [command, ...args] = item['command'] as string[];
      const env = isStringRecord(item['environment']) ? item['environment'] : undefined;
      result[name] = {
        command: command!,
        ...(args.length > 0 ? { args } : {}),
        ...(env ? { env } : {}),
      };
    }
  }
  return result;
}

interface TargetMcpEntries {
  names: ReadonlySet<string>;
  servers: CanonicalMcpMap;
  raw: Record<string, unknown>;
}

function targetMcpEntries(input: { provider: ProviderId; raw: string }): TargetMcpEntries {
  const { provider, raw } = input;
  if (raw.trim() === '') return { names: new Set(), servers: {}, raw: {} };
  if (provider === 'codex') return { names: codexServerNames(raw), servers: {}, raw: {} };
  const root = parseJsonRecord(raw, provider === 'opencode' ? 'opencode.json' : 'config.json');
  const entries = objectEntry(root, provider === 'opencode' ? 'mcp' : 'mcpServers');
  const servers =
    provider === 'opencode' ? extractOpencodeServers(root) : extractMcpServersMap(root);
  return { names: new Set(Object.keys(entries)), servers, raw: entries };
}

function maskRecordValues(record: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    masked[key] = '***';
  }
  return masked;
}

function maskMcpServer(server: McpServerConfig): McpServerConfig {
  if ('url' in server) {
    return {
      ...server,
      ...(server.headers ? { headers: maskRecordValues(server.headers) } : {}),
    };
  }
  return {
    ...server,
    ...(server.env ? { env: maskRecordValues(server.env) } : {}),
  };
}

export function maskMcpConfig(servers: CanonicalMcpMap): CanonicalMcpMap {
  const result: CanonicalMcpMap = {};
  for (const [name, server] of Object.entries(servers)) {
    result[name] = maskMcpServer(server);
  }
  return result;
}

function maskSensitiveTomlSections(text: string): string {
  const lines = text.split('\n');
  let insideSensitive = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      const headerMatch = /^\[(.+)\]$/.exec(trimmed);
      if (headerMatch) {
        const section = headerMatch[1]?.trim() ?? '';
        insideSensitive =
          section.endsWith('.env') ||
          section.endsWith('.headers') ||
          section.endsWith('.http_headers');
        return line;
      }
      if (!insideSensitive) return line;
      return line.replace(
        /^(\s*(?:"(?:[^"\\]|\\.)+"|[A-Za-z0-9_.-]+)\s*=\s*)"(?:[^"\\]|\\.)*"/,
        '$1"***"',
      );
    })
    .join('\n');
}

export function maskSecretsInText(text: string): string {
  const step1 = text
    .replace(
      /("(?:env|environment|headers|http_headers)"\s*:\s*\{)([^}]*)(\})/g,
      (_match, prefix: string, body: string, suffix: string) =>
        `${prefix}${body.replace(/("(?:[^"\\]|\\.)*"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"***"')}${suffix}`,
    )
    .replace(
      /(^\s*(?:http_headers|headers|env)\s*=\s*\{)([^}]*)(\})/gm,
      (_match, prefix: string, body: string, suffix: string) =>
        `${prefix}${body.replace(/(=\s*)"(?:[^"\\]|\\.)*"/g, '$1"***"')}${suffix}`,
    )
    .replace(/(Bearer\s+)[^\s"',}]+/gi, '$1***')
    .replace(/(^\s*[A-Z0-9_]+\s*=\s*)"(?:[^"\\]|\\.)*"/gm, '$1"***"');
  return maskSensitiveTomlSections(step1);
}

function stripTomlMcpSections(toml: string): string {
  const lines = toml.split('\n');
  const kept: string[] = [];
  let insideMcp = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const headerMatch = /^\[(.+)\]$/.exec(trimmed);
    if (headerMatch) {
      const section = headerMatch[1]?.trim() ?? '';
      insideMcp = section === 'mcp_servers' || section.startsWith('mcp_servers.');
    }
    if (!insideMcp) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

function isTomlServerDisabled(toml: string, name: string): boolean {
  const value = readTomlTableKey({
    toml,
    table: tomlTableHeader(['mcp_servers', name]),
    key: 'enabled',
  });
  return value !== null && /^false\b/.test(value);
}

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function codexServerNames(toml: string): Set<string> {
  if (!MCP_TABLES_PATTERN.test(toml)) return new Set();
  return new Set(
    listTomlTables(toml)
      .filter((segments) => segments.length === 2 && segments[0] === 'mcp_servers')
      .map((segments) => segments[1] ?? ''),
  );
}

interface CodexFormatResult {
  content: string;
  incompatible: { name: string; reason: string }[];
}

interface CodexServerBlocks {
  blocks: { name: string; text: string }[];
  incompatible: { name: string; reason: string }[];
}

function joinCodexSections(base: string, blocks: CodexServerBlocks['blocks']): string {
  const sections = [base, ...blocks.map((block) => block.text)].filter((part) => part !== '');
  return sections.length === 0 ? '' : `${sections.join('\n\n')}\n`;
}

export function formatCodexMcpToml(
  existingToml: string,
  servers: CanonicalMcpMap,
): CodexFormatResult {
  const base = stripTomlMcpSections(existingToml);
  const { blocks, incompatible } = codexServerBlocks(existingToml, servers);
  return { content: joinCodexSections(base, blocks), incompatible };
}

function formatCodexLibraryToml(input: {
  existingToml: string;
  servers: CanonicalMcpMap;
  strippedNames: readonly string[];
}): CodexFormatResult {
  const { existingToml, servers, strippedNames } = input;
  const { blocks, incompatible } = codexServerBlocks(existingToml, servers);
  const replaced = new Set([...blocks.map((block) => block.name), ...strippedNames]);
  const base = stripCodexServerTables({ toml: existingToml, names: replaced });
  return { content: joinCodexSections(base, blocks), incompatible };
}

function codexServerBlocks(existingToml: string, servers: CanonicalMcpMap): CodexServerBlocks {
  const disabledNames = new Set(
    [...codexServerNames(existingToml)].filter((name) => isTomlServerDisabled(existingToml, name)),
  );
  const blocks: CodexServerBlocks['blocks'] = [];
  const incompatible: { name: string; reason: string }[] = [];

  for (const [name, server] of Object.entries(servers)) {
    const key = formatTomlKey(name);
    if ('url' in server) {
      if (server.type === 'sse') {
        incompatible.push({
          name,
          reason:
            'Codex config.toml não suporta transporte SSE legado diretamente; use http ou stdio.',
        });
        continue;
      }
      const lines = [`[mcp_servers.${key}]`, `url = ${JSON.stringify(server.url)}`];
      if (server.headers && Object.keys(server.headers).length > 0) {
        const pairs = Object.entries(server.headers)
          .map(([hk, hv]) => `${formatTomlKey(hk)} = ${JSON.stringify(hv)}`)
          .join(', ');
        lines.push(`http_headers = { ${pairs} }`);
      }
      if (disabledNames.has(name)) lines.push('enabled = false');
      blocks.push({ name, text: lines.join('\n') });
      continue;
    }

    const lines = [`[mcp_servers.${key}]`, `command = ${JSON.stringify(server.command)}`];
    if (server.args && server.args.length > 0) {
      lines.push(`args = [${server.args.map((arg) => JSON.stringify(arg)).join(', ')}]`);
    }
    if (disabledNames.has(name)) lines.push('enabled = false');
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push('', `[mcp_servers.${key}.env]`);
      for (const [ek, ev] of Object.entries(server.env)) {
        lines.push(`${formatTomlKey(ek)} = ${JSON.stringify(ev)}`);
      }
    }
    blocks.push({ name, text: lines.join('\n') });
  }
  return { blocks, incompatible };
}

function parseJsonRecord(raw: string, label: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigParseError(`JSON inválido em ${label}: ${detail}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigParseError(`Objeto JSON esperado na raiz de ${label}.`);
  }
  return { ...(parsed as Record<string, unknown>) };
}

export function mergeOpencodeMcpJson(
  existingJson: string,
  servers: CanonicalMcpMap,
): { content: string; incompatible: { name: string; reason: string }[] } {
  const rootObj = parseJsonRecord(existingJson, 'opencode.json');
  const existingMcp =
    typeof rootObj['mcp'] === 'object' && rootObj['mcp'] !== null && !Array.isArray(rootObj['mcp'])
      ? { ...(rootObj['mcp'] as Record<string, unknown>) }
      : {};
  const incompatible: { name: string; reason: string }[] = [];

  for (const [name, server] of Object.entries(servers)) {
    if ('url' in server) {
      if (server.type === 'sse') {
        incompatible.push({
          name,
          reason: 'OpenCode espera transporte remoto HTTP padrão neste adaptador.',
        });
        continue;
      }
      existingMcp[name] = {
        type: 'remote',
        url: server.url,
        ...(server.headers ? { headers: server.headers } : {}),
      };
      continue;
    }
    existingMcp[name] = {
      type: 'local',
      command: [server.command, ...(server.args ?? [])],
      ...(server.env ? { environment: server.env } : {}),
    };
  }

  rootObj['mcp'] = existingMcp;
  return { content: `${JSON.stringify(rootObj, null, 2)}\n`, incompatible };
}

function preservedDisabledKeys(entry: unknown): { enabled?: false; disabled?: true } {
  if (typeof entry !== 'object' || entry === null) return {};
  const record = entry as Record<string, unknown>;
  return {
    ...(record['enabled'] === false ? { enabled: false as const } : {}),
    ...(record['disabled'] === true ? { disabled: true as const } : {}),
  };
}

export function mergeMcpServersJson(
  existingJson: string,
  servers: CanonicalMcpMap,
  label = 'config.json',
): string {
  const rootObj = parseJsonRecord(existingJson, label);
  const existing =
    typeof rootObj['mcpServers'] === 'object' &&
    rootObj['mcpServers'] !== null &&
    !Array.isArray(rootObj['mcpServers'])
      ? { ...(rootObj['mcpServers'] as Record<string, unknown>) }
      : {};
  for (const [name, server] of Object.entries(servers)) {
    existing[name] = { ...server, ...preservedDisabledKeys(existing[name]) };
  }
  rootObj['mcpServers'] = existing;
  return `${JSON.stringify(rootObj, null, 2)}\n`;
}

export function buildAgyMcpAddArgs(
  name: string,
  server: McpServerConfig,
): { args: string[] } | { incompatibleReason: string } {
  if ('url' in server) {
    if (server.type === 'sse') {
      return { incompatibleReason: 'Gemini (agy mcp add) aceita stdio ou http nesta integração.' };
    }
    const headerFlags: string[] = [];
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      headerFlags.push('-H', `${key}: ${value}`);
    }
    return { args: ['mcp', 'add', '-t', 'http', ...headerFlags, name, server.url] };
  }
  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(server.env ?? {})) {
    envFlags.push('-e', `${key}=${value}`);
  }
  return {
    args: [
      'mcp',
      'add',
      '-t',
      'stdio',
      ...envFlags,
      name,
      '--',
      server.command,
      ...(server.args ?? []),
    ],
  };
}

export function buildAgyMcpRemoveArgs(name: string): string[] {
  return ['mcp', 'remove', name];
}

export function buildClaudeMcpAddJsonArgs(name: string, server: McpServerConfig): string[] {
  return ['mcp', 'add-json', '--scope', 'user', name, JSON.stringify(server)];
}

async function detectAvailableRules(projectPath: string): Promise<RulesFile[]> {
  const found: RulesFile[] = [];
  for (const file of RULES_FILES) {
    if ((await readOptionalFile(join(projectPath, file))) !== null) found.push(file);
  }
  return found;
}

interface PlannedTarget {
  item: Omit<ProfileSyncItem, 'approvalKey'>;
  rawPath: string;
  rawBefore?: string;
  rawAfter?: string;
  unwrittenNames?: string[];
  managedKey?: string;
  ownedHashes?: ManagedHashes;
  removedNames?: string[];
  prunedNames?: string[];
  projectNames?: string[];
  keyBefore?: string;
  keyAfter?: string;
}

interface KeyedTarget extends Omit<PlannedTarget, 'item'> {
  item: ProfileSyncItem;
}

function withApprovalKey(input: { planned: PlannedTarget; fallbackAfter: string }): KeyedTarget {
  const { planned, fallbackAfter } = input;
  const { id, status } = planned.item;
  const key = approvalKey({
    id,
    status,
    before: planned.keyBefore ?? planned.rawBefore ?? '',
    after: planned.keyAfter ?? planned.rawAfter ?? fallbackAfter,
  });
  return { ...planned, item: { ...planned.item, approvalKey: key } };
}

function mcpTargetPath(account: ProfileSyncAccountInput, projectPath: string): string {
  switch (account.provider) {
    case 'claude':
      return join(account.homeDir, '.claude.json');
    case 'codex':
      return join(account.homeDir, 'config.toml');
    case 'gemini':
      return join(account.homeDir, '.gemini', 'settings.json');
    case 'opencode':
      return join(projectPath, 'opencode.json');
    case 'qwen':
      return join(account.homeDir, '.qwen', 'settings.json');
    case 'deepseek':
    case 'grok':
    case 'kimi':
      return account.homeDir;
  }
}

async function planAccountMcpTarget(input: {
  account: ProfileSyncAccountInput;
  projectPath: string;
  servers: CanonicalMcpMap;
  strippedNames?: readonly string[];
  before?: string;
}): Promise<PlannedTarget> {
  const { account, projectPath, servers, strippedNames } = input;
  const maskedPreview = JSON.stringify({ mcpServers: maskMcpConfig(servers) }, null, 2);
  const targetPath = mcpTargetPath(account, projectPath);
  const readBefore = async (): Promise<string> =>
    input.before ?? (await readOptionalFile(targetPath)) ?? '';

  if (account.provider === 'claude') {
    const before = await readBefore();
    const after = mergeMcpServersJson(before, servers, '.claude.json');
    const status: ProfileSyncStatus =
      Object.keys(servers).length === 0
        ? 'unchanged'
        : before === ''
          ? 'create'
          : before === after
            ? 'unchanged'
            : 'update';
    return {
      rawPath: targetPath,
      rawBefore: before,
      rawAfter: after,
      item: {
        id: `mcp:${account.id}`,
        scope: 'mcp',
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        targetPath,
        status,
        maskedBefore: maskSecretsInText(before),
        maskedAfter: maskSecretsInText(after),
      },
    };
  }

  if (account.provider === 'codex') {
    const before = await readBefore();
    let formatted: CodexFormatResult;
    try {
      formatted = strippedNames
        ? formatCodexLibraryToml({ existingToml: before, servers, strippedNames })
        : formatCodexMcpToml(before, servers);
    } catch (error: unknown) {
      if (!(error instanceof CapabilityFileError)) throw error;
      return {
        rawPath: targetPath,
        rawBefore: before,
        item: {
          id: `mcp:${account.id}`,
          scope: 'mcp',
          provider: account.provider,
          accountId: account.id,
          accountLabel: account.label,
          targetPath,
          status: 'conflict',
          reason:
            'Não foi possível ler quais MCPs estão desligados no config.toml. Sincronize manualmente.',
          maskedBefore: maskSecretsInText(before),
          maskedAfter: maskSecretsInText(before),
        },
      };
    }
    const firstBad = formatted.incompatible[0];
    const status: ProfileSyncStatus =
      firstBad && Object.keys(servers).length === formatted.incompatible.length
        ? 'incompatible'
        : Object.keys(servers).length === 0
          ? 'unchanged'
          : before === ''
            ? 'create'
            : before === formatted.content
              ? 'unchanged'
              : 'update';
    return {
      rawPath: targetPath,
      rawBefore: before,
      rawAfter: formatted.content,
      unwrittenNames: formatted.incompatible.map((entry) => entry.name),
      item: {
        id: `mcp:${account.id}`,
        scope: 'mcp',
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        targetPath,
        status,
        ...(firstBad ? { reason: firstBad.reason } : {}),
        maskedBefore: maskSecretsInText(before),
        maskedAfter: maskSecretsInText(formatted.content),
      },
    };
  }

  if (account.provider === 'gemini') {
    const cliCompatible = Object.entries(servers).filter(
      ([name, server]) => !('incompatibleReason' in buildAgyMcpAddArgs(name, server)),
    );
    const firstIncompatible = Object.entries(servers)
      .map(([name, server]) => buildAgyMcpAddArgs(name, server))
      .find((res): res is { incompatibleReason: string } => 'incompatibleReason' in res);
    const status: ProfileSyncStatus =
      Object.keys(servers).length === 0
        ? 'unchanged'
        : cliCompatible.length === 0 && firstIncompatible
          ? 'incompatible'
          : 'update';
    return {
      rawPath: targetPath,
      item: {
        id: `mcp:${account.id}`,
        scope: 'mcp',
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        targetPath,
        status,
        ...(firstIncompatible ? { reason: firstIncompatible.incompatibleReason } : {}),
        maskedBefore: '',
        maskedAfter: maskedPreview,
      },
    };
  }

  if (account.provider === 'opencode') {
    const before = await readBefore();
    const merged = mergeOpencodeMcpJson(before, servers);
    const firstBad = merged.incompatible[0];
    const status: ProfileSyncStatus =
      firstBad && Object.keys(servers).length === merged.incompatible.length
        ? 'incompatible'
        : Object.keys(servers).length === 0
          ? 'unchanged'
          : before === ''
            ? 'create'
            : before === merged.content
              ? 'unchanged'
              : 'update';
    return {
      rawPath: targetPath,
      rawBefore: before,
      rawAfter: merged.content,
      unwrittenNames: merged.incompatible.map((entry) => entry.name),
      item: {
        id: `mcp:${account.id}`,
        scope: 'mcp',
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        targetPath,
        status,
        ...(firstBad ? { reason: firstBad.reason } : {}),
        maskedBefore: maskSecretsInText(before),
        maskedAfter: maskSecretsInText(merged.content),
      },
    };
  }

  if (account.provider === 'qwen') {
    const before = await readBefore();
    const after = mergeMcpServersJson(before, servers, '.qwen/settings.json');
    const status: ProfileSyncStatus =
      Object.keys(servers).length === 0
        ? 'unchanged'
        : before === ''
          ? 'create'
          : before === after
            ? 'unchanged'
            : 'update';
    return {
      rawPath: targetPath,
      rawBefore: before,
      rawAfter: after,
      item: {
        id: `mcp:${account.id}`,
        scope: 'mcp',
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        targetPath,
        status,
        maskedBefore: maskSecretsInText(before),
        maskedAfter: maskSecretsInText(after),
      },
    };
  }

  return {
    rawPath: account.homeDir,
    item: {
      id: `mcp:${account.id}`,
      scope: 'mcp',
      provider: account.provider,
      accountId: account.id,
      accountLabel: account.label,
      targetPath: account.homeDir,
      status: 'incompatible',
      reason: `O provedor ${account.provider} não possui formato padronizado de MCP para sincronização (suporte não verificado).`,
      maskedBefore: '',
      maskedAfter: '',
    },
  };
}

function unmanagedEntryStates(input: { planned: PlannedTarget; names: readonly string[] }): {
  identical: string[];
  changed: string[];
} {
  const { planned } = input;
  const { provider } = planned.item;
  const before = targetMcpEntries({ provider, raw: planned.rawBefore ?? '' });
  const present = input.names.filter((name) => before.names.has(name));
  if (provider === 'codex' || planned.rawAfter === undefined) {
    return { identical: [], changed: present };
  }
  const after = targetMcpEntries({ provider, raw: planned.rawAfter }).raw;
  const same = (name: string): boolean => isDeepStrictEqual(before.raw[name], after[name]);
  return {
    identical: present.filter(same),
    changed: present.filter((name) => !same(name)),
  };
}

function unmanagedLibraryNames(input: {
  projection: LibraryMcpProjection;
  managedNames: readonly string[];
}): string[] {
  return input.projection.libraryNames.filter((name) => !input.managedNames.includes(name));
}

function libraryExclusionReason(unverifiedNames: readonly string[]): string {
  return `Itens da biblioteca ignorados (${unverifiedNames.join(', ')}): variável \${VAR} não verificada neste provider.`;
}

function annotateLibraryTarget(input: {
  planned: PlannedTarget;
  projection: LibraryMcpProjection;
  managedNames: readonly string[];
}): PlannedTarget {
  const { planned, projection, managedNames } = input;
  const { item } = planned;
  const notes = item.reason ? [item.reason] : [];
  let status = item.status;
  if (projection.unverifiedNames.length > 0) {
    notes.push(libraryExclusionReason(projection.unverifiedNames));
    const removes = (planned.removedNames ?? []).length > 0;
    if (Object.keys(projection.servers).length === 0 && !removes) status = 'incompatible';
  }
  const writable = (status === 'create' || status === 'update') && item.provider !== 'gemini';
  const entries = writable
    ? targetMcpEntries({ provider: item.provider, raw: planned.rawBefore ?? '' })
    : { names: new Set<string>(), servers: {}, raw: {} };
  const conflicts = writable
    ? unmanagedEntryStates({ planned, names: unmanagedLibraryNames({ projection, managedNames }) })
        .changed
    : [];
  if (conflicts.length > 0) {
    status = 'conflict';
    notes.push(
      `MCP existente sem marcador da IDE e com definição diferente: ${conflicts.join(', ')}.`,
    );
  }
  const ownedNames = projection.libraryNames.filter(
    (name) => !entries.names.has(name) || conflicts.includes(name) || managedNames.includes(name),
  );
  const reason = notes.length > 0 ? { reason: notes.join(' ') } : {};
  const ownedHashes = ownedHashesOf({ planned, names: ownedNames });
  return { ...planned, ownedHashes, item: { ...item, status, ...reason } };
}

function mcpEntryHash(input: { provider: ProviderId; raw: string; name: string }): string | null {
  const { provider, raw, name } = input;
  if (provider === 'codex') {
    const text = codexServerTableText({ toml: raw, name });
    return text === null ? null : stableHash(text);
  }
  const { servers } = targetMcpEntries({ provider, raw });
  return Object.hasOwn(servers, name) ? stableHash(servers[name]) : null;
}

function ownedHashesOf(input: { planned: PlannedTarget; names: readonly string[] }): ManagedHashes {
  const { rawAfter, item } = input.planned;
  if (rawAfter === undefined) return {};
  const hashes = input.names.map((name) => [
    name,
    mcpEntryHash({ provider: item.provider, raw: rawAfter, name }),
  ]);
  return Object.fromEntries(hashes.filter((entry): entry is [string, string] => entry[1] !== null));
}

interface ProfileSyncPlan {
  preview: ProfileSyncPreview;
  targets: KeyedTarget[];
  skills: SkillPlanEntry[];
  projections: Map<string, LibraryMcpProjection>;
  managed: ManagedRegistry;
}

async function planAccountTarget(input: {
  account: ProfileSyncAccountInput;
  projectPath: string;
  projectServers: CanonicalMcpMap;
  library: ProfileSyncLibraryInput | undefined;
  managed: ManagedRegistry;
}): Promise<{ planned: PlannedTarget; projection: LibraryMcpProjection }> {
  const { account, projectPath, projectServers, library, managed } = input;
  if (!library) {
    const projection = { servers: projectServers, libraryNames: [], unverifiedNames: [] };
    return {
      planned: await planAccountMcpTarget({ account, projectPath, servers: projectServers }),
      projection,
    };
  }
  try {
    return await planLibraryAccountTarget({
      account,
      projectPath,
      projectServers,
      library,
      managed,
    });
  } catch (error: unknown) {
    if (!isUnreadableConfigError(error)) throw error;
    return {
      planned: unreadableMcpTarget(account, projectPath),
      projection: { servers: {}, libraryNames: [], unverifiedNames: [] },
    };
  }
}

function unreadableMcpTarget(account: ProfileSyncAccountInput, projectPath: string): PlannedTarget {
  const targetPath = mcpTargetPath(account, projectPath);
  return {
    rawPath: targetPath,
    item: {
      id: `mcp:${account.id}`,
      scope: 'mcp',
      provider: account.provider,
      accountId: account.id,
      accountLabel: account.label,
      targetPath,
      status: 'conflict',
      reason: `Arquivo de configuração ilegível: ${basename(targetPath)}. Corrija ou restaure o arquivo.`,
      maskedBefore: '',
      maskedAfter: '',
    },
  };
}

async function planLibraryAccountTarget(input: {
  account: ProfileSyncAccountInput;
  projectPath: string;
  projectServers: CanonicalMcpMap;
  library: ProfileSyncLibraryInput;
  managed: ManagedRegistry;
}): Promise<{ planned: PlannedTarget; projection: LibraryMcpProjection }> {
  const { account, projectPath, projectServers, library, managed } = input;
  const projected = projectLibraryMcp({
    projectServers,
    items: library.items,
    projectDisabled: library.projectDisabled,
    accountDisabled: account.disabledCapabilities ?? [],
    provider: account.provider,
  });
  const targetPath = mcpTargetPath(account, projectPath);
  const managedKey = managedTargetKey({
    provider: account.provider,
    accountId: account.id,
    targetPath,
  });
  const managedNames = managedNamesFor(managed, managedKey);
  const candidates = removalCandidates({
    managedNames,
    retained: retainedMcpNames({
      library,
      projectServers,
      accountDisabled: account.disabledCapabilities ?? [],
      provider: account.provider,
    }),
  });
  const before = FILE_MCP_PROVIDERS.includes(account.provider)
    ? ((await readOptionalFile(targetPath)) ?? '')
    : undefined;
  const split =
    before === undefined
      ? { removed: candidates, pruned: [] }
      : splitRemovalByHash({
          candidates,
          stored: managedHashesFor(managed, managedKey),
          current: (name) => mcpEntryHash({ provider: account.provider, raw: before, name }),
        });
  const planned = await planLibraryMerge({
    target: {
      account,
      projectPath,
      servers: projected.servers,
      strippedNames: split.removed,
      ...(before === undefined ? {} : { before }),
    },
    unmanagedNames: unmanagedLibraryNames({ projection: projected, managedNames }),
  });
  const unwritten = planned.unwrittenNames ?? [];
  const projection = {
    ...projected,
    libraryNames: projected.libraryNames.filter((name) => !unwritten.includes(name)),
  };
  const annotated = annotateLibraryTarget({
    planned: withMcpRemoval({
      planned: {
        ...planned,
        managedKey,
        projectNames: Object.keys(projectServers).filter((name) => !unwritten.includes(name)),
      },
      split,
    }),
    projection,
    managedNames,
  });
  return {
    planned: withMcpSubsetKey(withLibraryView({ planned: annotated, servers: projected.servers })),
    projection,
  };
}

function mcpSubsetText(input: { provider: ProviderId; raw: string }): string {
  if (input.provider === 'codex') return codexMcpTablesText(input.raw);
  return stableHash(targetMcpEntries(input).raw);
}

function withMcpSubsetKey(planned: PlannedTarget): PlannedTarget {
  const { item, rawBefore, rawAfter } = planned;
  if (rawBefore === undefined) return planned;
  const keyBefore = mcpSubsetText({ provider: item.provider, raw: rawBefore });
  if (rawAfter === undefined) return { ...planned, keyBefore };
  const after = mcpSubsetText({ provider: item.provider, raw: rawAfter });
  return { ...planned, keyBefore, keyAfter: JSON.stringify([after, planned.removedNames ?? []]) };
}

const FILE_MCP_PROVIDERS: readonly ProviderId[] = ['claude', 'codex', 'opencode', 'qwen'];

async function planLibraryMerge(input: {
  target: Parameters<typeof planAccountMcpTarget>[0];
  unmanagedNames: readonly string[];
}): Promise<PlannedTarget> {
  const { target, unmanagedNames } = input;
  const first = await planAccountMcpTarget(target);
  const { identical } = unmanagedEntryStates({ planned: first, names: unmanagedNames });
  if (identical.length === 0) return first;
  const servers = Object.entries(target.servers).filter(([name]) => !identical.includes(name));
  return planAccountMcpTarget({ ...target, servers: Object.fromEntries(servers) });
}

function withMcpRemoval(input: {
  planned: PlannedTarget;
  split: { removed: string[]; pruned: string[] };
}): PlannedTarget {
  const { planned } = input;
  const { provider } = planned.item;
  if (provider !== 'gemini' && planned.rawAfter === undefined) return planned;
  const { removed, pruned } = input.split;
  if (removed.length === 0) return { ...planned, prunedNames: pruned };
  const { item, rawAfter } = planned;
  const rawWithout =
    rawAfter === undefined || item.provider === 'codex'
      ? rawAfter
      : withoutJsonServers({
          raw: rawAfter,
          key: item.provider === 'opencode' ? 'mcp' : 'mcpServers',
          names: removed,
        });
  const reason = [item.reason, removalReason(removed)].filter(Boolean).join(' ');
  return {
    ...planned,
    ...(rawWithout === undefined ? {} : { rawAfter: rawWithout }),
    removedNames: removed,
    prunedNames: pruned,
    item: { ...item, status: statusWithRemoval(item.status), reason },
  };
}

function libraryMcpView(input: { provider: ProviderId; raw: string }): string {
  const { provider, raw } = input;
  if (raw.trim() === '') return '';
  if (provider === 'codex') return maskSecretsInText(codexMcpTablesText(raw));
  const servers = maskViewServers(targetMcpEntries({ provider, raw }).servers);
  return JSON.stringify({ [provider === 'opencode' ? 'mcp' : 'mcpServers']: servers }, null, 2);
}

function maskViewServer(server: McpServerConfig): McpServerConfig {
  if ('url' in server) return { ...server, url: maskUrlSecrets(maskSecretsInText(server.url)) };
  return server.args ? { ...server, args: server.args.map(maskSecretsInText) } : server;
}

function maskViewServers(servers: CanonicalMcpMap): CanonicalMcpMap {
  const masked = Object.entries(maskMcpConfig(servers));
  return Object.fromEntries(masked.map(([name, server]) => [name, maskViewServer(server)]));
}

function withLibraryView(input: {
  planned: PlannedTarget;
  servers: CanonicalMcpMap;
}): PlannedTarget {
  const { planned } = input;
  const { item, rawBefore, rawAfter } = planned;
  if (item.provider === 'gemini') {
    const maskedAfter = JSON.stringify({ mcpServers: maskViewServers(input.servers) }, null, 2);
    return { ...planned, item: { ...item, maskedAfter } };
  }
  if (rawBefore === undefined) return planned;
  const maskedBefore = libraryMcpView({ provider: item.provider, raw: rawBefore });
  const maskedAfter = libraryMcpView({ provider: item.provider, raw: rawAfter ?? rawBefore });
  return { ...planned, item: { ...item, maskedBefore, maskedAfter } };
}

async function planProfileTargets(input: {
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
  sourceAccountId?: string | null;
  root?: string;
  library?: ProfileSyncLibraryInput;
  scopes?: readonly ProfileSyncScope[];
}): Promise<ProfileSyncPlan> {
  const scopes = input.scopes ?? ALL_SCOPES;
  const mcp = await readCanonicalMcpConfig({ projectPath: input.projectPath });
  let servers = mcp.servers;
  if (!mcp.exists && input.sourceAccountId) {
    const sourceAccount = input.accounts.find((account) => account.id === input.sourceAccountId);
    if (sourceAccount) {
      servers = await readAccountMcpConfig({
        account: sourceAccount,
        projectPath: input.projectPath,
      });
    }
  }
  const availableRulesFiles = await detectAvailableRules(input.projectPath);
  const resolvedSource =
    input.rulesSource && availableRulesFiles.includes(input.rulesSource)
      ? input.rulesSource
      : (availableRulesFiles[0] ?? null);

  const managed: ManagedRegistry =
    input.library && input.root ? await loadManaged(input.root) : emptyManaged();
  const targets: KeyedTarget[] = [];
  const projections = new Map<string, LibraryMcpProjection>();
  for (const account of scopes.includes('mcp') ? input.accounts : []) {
    const { planned, projection } = await planAccountTarget({
      account,
      projectPath: input.projectPath,
      projectServers: servers,
      library: input.library,
      managed,
    });
    const fallbackAfter = JSON.stringify([projection.servers, planned.removedNames ?? []]);
    targets.push(withApprovalKey({ planned, fallbackAfter }));
    projections.set(account.id, projection);
  }

  if (resolvedSource && scopes.includes('rules')) {
    const sourceContent = (await readOptionalFile(join(input.projectPath, resolvedSource))) ?? '';
    const seenRuleFiles = new Set<RulesFile>([resolvedSource]);
    for (const account of input.accounts) {
      const targetRule = PROVIDER_RULE_FILE[account.provider];
      if (!targetRule || seenRuleFiles.has(targetRule)) continue;
      seenRuleFiles.add(targetRule);

      const targetPath = join(input.projectPath, targetRule);
      const existing = await readOptionalFile(targetPath);
      const status: ProfileSyncStatus =
        existing === null ? 'create' : existing === sourceContent ? 'unchanged' : 'conflict';
      const planned: PlannedTarget = {
        rawPath: targetPath,
        rawBefore: existing ?? '',
        rawAfter: sourceContent,
        item: {
          id: `rules:${targetRule}`,
          scope: 'rules',
          provider: account.provider,
          targetPath,
          status,
          ...(status === 'conflict'
            ? { reason: `${targetRule} possui conteúdo diferente de ${resolvedSource}.` }
            : {}),
          maskedBefore: existing ?? '',
          maskedAfter: sourceContent,
        },
      };
      targets.push(withApprovalKey({ planned, fallbackAfter: '' }));
    }
  }

  const skills =
    input.library && input.root && scopes.includes('skill')
      ? await planSkillTargets({
          root: input.root,
          accounts: input.accounts,
          library: input.library,
        })
      : [];

  return {
    preview: {
      mcpSourceExists: mcp.exists,
      mcpServerCount: Object.keys(servers).length,
      rulesSource: resolvedSource,
      availableRulesFiles,
      items: [...targets.map((entry) => entry.item), ...skills.map((entry) => entry.item)],
    },
    targets,
    skills,
    projections,
    managed,
  };
}

export async function previewProfileSync(input: {
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
  sourceAccountId?: string | null;
  root?: string;
  library?: ProfileSyncLibraryInput;
  scopes?: readonly ProfileSyncScope[];
}): Promise<ProfileSyncPreview> {
  const { preview } = await planProfileTargets(input);
  return preview;
}

async function backupExistingFile(input: {
  targetPath: string;
  backupDir: string;
  index: number;
}): Promise<boolean> {
  try {
    const stats = await lstat(input.targetPath);
    if (!stats.isFile() && !stats.isSymbolicLink()) return false;
  } catch (error: unknown) {
    if (isMissingFile(error)) return false;
    throw error;
  }
  await mkdir(input.backupDir, { recursive: true, mode: 0o700 });
  const safeName = input.targetPath.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const dest = join(input.backupDir, `${String(input.index).padStart(2, '0')}_${safeName}`);
  const linkStats = await lstat(input.targetPath);
  if (linkStats.isSymbolicLink()) {
    const linkTarget = await readlink(input.targetPath);
    await writeFile(dest, `symlink -> ${linkTarget}\n`, { mode: 0o600 });
  } else {
    await copyFile(input.targetPath, dest);
  }
  return true;
}

function writeSerialized(path: string, content: string): Promise<void> {
  return serialize(path, () => writeAtomic(path, content));
}

export async function applyProfileSync(input: {
  root: string;
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
  sourceAccountId?: string | null;
  approvedIds: readonly string[];
  rulesStrategy?: RulesStrategy;
  runner?: CommandRunner;
  baseEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
  library?: ProfileSyncLibraryInput;
  scopes?: readonly ProfileSyncScope[];
  approvals?: ApprovalMode;
}): Promise<ProfileSyncApplyResult> {
  const timestamp = (input.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backupDir = join(input.root, 'backups', 'profile-sync', timestamp);
  const approved = new Set(input.approvedIds);
  const strategy = input.rulesStrategy ?? 'copy';
  const { targets, skills, projections, managed, preview } = await planProfileTargets({
    root: input.root,
    projectPath: input.projectPath,
    accounts: input.accounts,
    ...(input.rulesSource !== undefined ? { rulesSource: input.rulesSource } : {}),
    ...(input.sourceAccountId !== undefined ? { sourceAccountId: input.sourceAccountId } : {}),
    ...(input.library ? { library: input.library } : {}),
    ...(input.scopes ? { scopes: input.scopes } : {}),
  });
  const recordManaged = async (
    planned: KeyedTarget,
    change: { add: ManagedHashes; drop: readonly string[] },
  ): Promise<void> => {
    const targetKey = planned.managedKey;
    if (!input.library || targetKey === undefined) return;
    if (Object.keys(change.add).length === 0 && change.drop.length === 0) return;
    await changeManaged({
      root: input.root,
      targetKey,
      ...change,
      ...(input.now ? { now: input.now } : {}),
    });
  };
  const pruneManaged = (planned: KeyedTarget): Promise<void> => {
    const inPlace = planned.item.status === 'unchanged' ? (planned.projectNames ?? []) : [];
    return recordManaged(planned, { add: {}, drop: [...(planned.prunedNames ?? []), ...inPlace] });
  };

  const appliedIds: string[] = [];
  const skippedIds: string[] = [];
  const accountById = new Map(input.accounts.map((account) => [account.id, account] as const));
  let backupIndex = 1;

  for (const planned of targets) {
    const { item } = planned;
    if (item.status === 'unchanged' || item.status === 'incompatible') {
      await pruneManaged(planned);
      skippedIds.push(item.id);
      continue;
    }
    const isApproved = approved.has(approvalToken({ mode: input.approvals, item }));
    if ((item.status === 'update' || item.status === 'conflict') && !isApproved) {
      await pruneManaged(planned);
      skippedIds.push(item.id);
      continue;
    }

    if (item.scope === 'mcp' && item.provider === 'gemini') {
      const account = item.accountId ? accountById.get(item.accountId) : undefined;
      if (!account || !input.runner) {
        skippedIds.push(item.id);
        continue;
      }
      const env = { ...(input.baseEnv ?? process.env), HOME: account.homeDir };
      const listed = await input.runner.run({ command: 'agy', args: ['mcp', 'list'], env });
      const listedItems =
        'exitCode' in listed && listed.exitCode === 0 ? parseMcpItems(listed.stdout) : null;
      if (listedItems === null) {
        skippedIds.push(item.id);
        continue;
      }
      await backupExistingFile({ targetPath: planned.rawPath, backupDir, index: backupIndex++ });
      let okAll = true;
      const disabledBefore = new Set(
        listedItems.filter((mcp) => !mcp.enabled).map((mcp) => mcp.id),
      );
      const listedNames = new Set(listedItems.map((mcp) => mcp.id));
      const projection = projections.get(account.id);
      const libraryNames = new Set(projection?.libraryNames ?? []);
      const managedNames =
        planned.managedKey === undefined ? [] : managedNamesFor(managed, planned.managedKey);
      const { runner } = input;
      const removal = await removeAgyServers({
        names: planned.removedNames ?? [],
        listed: listedNames,
        remove: async (name) => {
          const result = await runner.run({
            command: 'agy',
            args: buildAgyMcpRemoveArgs(name),
            env,
          });
          return 'exitCode' in result && result.exitCode === 0;
        },
      });
      if (removal.failed) okAll = false;
      const writtenLibraryNames: string[] = [];
      const writtenProjectNames: string[] = [];
      for (const [name, server] of Object.entries(projection?.servers ?? {})) {
        const built = buildAgyMcpAddArgs(name, server);
        if ('incompatibleReason' in built) continue;
        const isLibrary = libraryNames.has(name);
        if (isLibrary && listedNames.has(name) && !managedNames.includes(name)) {
          okAll = false;
          continue;
        }
        await input.runner.run({ command: 'agy', args: buildAgyMcpRemoveArgs(name), env });
        const result = await input.runner.run({ command: 'agy', args: built.args, env });
        if ('notFound' in result || result.exitCode !== 0) {
          okAll = false;
          continue;
        }
        (isLibrary ? writtenLibraryNames : writtenProjectNames).push(name);
        if (disabledBefore.has(name)) {
          const disabled = await input.runner.run({
            command: 'agy',
            args: ['mcp', 'disable', name],
            env,
          });
          if ('notFound' in disabled || disabled.exitCode !== 0) okAll = false;
        }
      }
      await recordManaged(planned, {
        add: Object.fromEntries(writtenLibraryNames.map((name) => [name, ''])),
        drop: [...removal.dropped, ...writtenProjectNames],
      });
      if (okAll) appliedIds.push(item.id);
      else skippedIds.push(item.id);
      continue;
    }

    if (planned.rawAfter === undefined) {
      skippedIds.push(item.id);
      continue;
    }

    await backupExistingFile({ targetPath: planned.rawPath, backupDir, index: backupIndex++ });

    if (item.scope === 'rules' && strategy === 'symlink' && preview.rulesSource) {
      const sourcePath = join(input.projectPath, preview.rulesSource);
      const rel = relative(dirname(planned.rawPath), sourcePath);
      await rm(planned.rawPath, { force: true });
      try {
        await symlink(rel, planned.rawPath);
        appliedIds.push(item.id);
        continue;
      } catch {
        await writeSerialized(planned.rawPath, planned.rawAfter);
        appliedIds.push(item.id);
        continue;
      }
    }

    await writeSerialized(planned.rawPath, planned.rawAfter);
    if (item.scope === 'mcp') {
      await recordManaged(planned, {
        add: planned.ownedHashes ?? {},
        drop: [
          ...(planned.removedNames ?? []),
          ...(planned.prunedNames ?? []),
          ...(planned.projectNames ?? []),
        ],
      });
    }
    appliedIds.push(item.id);
  }

  for (const entry of skills) {
    const outcome = await applySkillEntry({
      root: input.root,
      entry,
      backupDir,
      approved,
      ...(input.approvals ? { approvals: input.approvals } : {}),
    });
    (outcome === 'applied' ? appliedIds : skippedIds).push(entry.item.id);
  }

  return { backupDir, appliedIds, skippedIds };
}
