import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { CommandRunner } from './providers.js';
import type { ProviderId } from './types.js';

export type RulesFile = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';

export type RulesStrategy = 'copy' | 'symlink';

export type ProfileSyncStatus = 'create' | 'update' | 'unchanged' | 'conflict' | 'incompatible';

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
}

export interface ProfileSyncItem {
  id: string;
  scope: 'mcp' | 'rules';
  provider: ProviderId;
  accountId?: string;
  accountLabel?: string;
  targetPath: string;
  status: ProfileSyncStatus;
  reason?: string;
  maskedBefore: string;
  maskedAfter: string;
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

const RULES_FILES: readonly RulesFile[] = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

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

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.inova.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
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

export function maskSecretsInText(text: string): string {
  return text
    .replace(
      /("(?:env|environment|headers|http_headers)"\s*:\s*\{)([^}]*)(\})/g,
      (_match, prefix: string, body: string, suffix: string) =>
        `${prefix}${body.replace(/("(?:[^"\\]|\\.)*"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"***"')}${suffix}`,
    )
    .replace(/(Bearer\s+)[^\s"',}]+/gi, '$1***')
    .replace(/(^\s*[A-Z0-9_]+\s*=\s*)"(?:[^"\\]|\\.)*"/gm, '$1"***"');
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

function formatTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

export function formatCodexMcpToml(
  existingToml: string,
  servers: CanonicalMcpMap,
): { content: string; incompatible: { name: string; reason: string }[] } {
  const base = stripTomlMcpSections(existingToml);
  const blocks: string[] = [];
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
      blocks.push(lines.join('\n'));
      continue;
    }

    const lines = [`[mcp_servers.${key}]`, `command = ${JSON.stringify(server.command)}`];
    if (server.args && server.args.length > 0) {
      lines.push(`args = [${server.args.map((arg) => JSON.stringify(arg)).join(', ')}]`);
    }
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push('', `[mcp_servers.${key}.env]`);
      for (const [ek, ev] of Object.entries(server.env)) {
        lines.push(`${formatTomlKey(ek)} = ${JSON.stringify(ev)}`);
      }
    }
    blocks.push(lines.join('\n'));
  }

  const sections = [base, ...blocks].filter((part) => part !== '');
  return {
    content: sections.length === 0 ? '' : `${sections.join('\n\n')}\n`,
    incompatible,
  };
}

export function mergeOpencodeMcpJson(
  existingJson: string,
  servers: CanonicalMcpMap,
): { content: string; incompatible: { name: string; reason: string }[] } {
  let rootObj: Record<string, unknown> = {};
  if (existingJson.trim() !== '') {
    const parsed: unknown = JSON.parse(existingJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      rootObj = { ...(parsed as Record<string, unknown>) };
    }
  }
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

export function mergeMcpServersJson(existingJson: string, servers: CanonicalMcpMap): string {
  let rootObj: Record<string, unknown> = {};
  if (existingJson.trim() !== '') {
    const parsed: unknown = JSON.parse(existingJson);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      rootObj = { ...(parsed as Record<string, unknown>) };
    }
  }
  const existing =
    typeof rootObj['mcpServers'] === 'object' &&
    rootObj['mcpServers'] !== null &&
    !Array.isArray(rootObj['mcpServers'])
      ? { ...(rootObj['mcpServers'] as Record<string, unknown>) }
      : {};
  for (const [name, server] of Object.entries(servers)) {
    existing[name] = server;
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
  item: ProfileSyncItem;
  rawPath: string;
  rawAfter?: string;
}

async function planAccountMcpTarget(input: {
  account: ProfileSyncAccountInput;
  projectPath: string;
  servers: CanonicalMcpMap;
}): Promise<PlannedTarget> {
  const { account, projectPath, servers } = input;
  const maskedPreview = JSON.stringify({ mcpServers: maskMcpConfig(servers) }, null, 2);

  if (account.provider === 'claude') {
    const targetPath = join(account.homeDir, '.claude.json');
    const before = (await readOptionalFile(targetPath)) ?? '';
    const after = mergeMcpServersJson(before, servers);
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
    const targetPath = join(account.homeDir, 'config.toml');
    const before = (await readOptionalFile(targetPath)) ?? '';
    const formatted = formatCodexMcpToml(before, servers);
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
      rawAfter: formatted.content,
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
    const targetPath = join(account.homeDir, '.gemini', 'settings.json');
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
    const targetPath = join(projectPath, 'opencode.json');
    const before = (await readOptionalFile(targetPath)) ?? '';
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
      rawAfter: merged.content,
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
    const targetPath = join(account.homeDir, '.qwen', 'settings.json');
    const before = (await readOptionalFile(targetPath)) ?? '';
    const after = mergeMcpServersJson(before, servers);
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
      reason: `O provedor ${account.provider} não possui formato padronizado de MCP para sincronização.`,
      maskedBefore: '',
      maskedAfter: '',
    },
  };
}

async function planProfileTargets(input: {
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
}): Promise<{ preview: ProfileSyncPreview; targets: PlannedTarget[]; servers: CanonicalMcpMap }> {
  const mcp = await readCanonicalMcpConfig({ projectPath: input.projectPath });
  const availableRulesFiles = await detectAvailableRules(input.projectPath);
  const resolvedSource =
    input.rulesSource && availableRulesFiles.includes(input.rulesSource)
      ? input.rulesSource
      : (availableRulesFiles[0] ?? null);

  const targets: PlannedTarget[] = [];
  for (const account of input.accounts) {
    targets.push(
      await planAccountMcpTarget({
        account,
        projectPath: input.projectPath,
        servers: mcp.servers,
      }),
    );
  }

  if (resolvedSource) {
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
      targets.push({
        rawPath: targetPath,
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
      });
    }
  }

  return {
    preview: {
      mcpSourceExists: mcp.exists,
      mcpServerCount: Object.keys(mcp.servers).length,
      rulesSource: resolvedSource,
      availableRulesFiles,
      items: targets.map((entry) => entry.item),
    },
    targets,
    servers: mcp.servers,
  };
}

export async function previewProfileSync(input: {
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
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

export async function applyProfileSync(input: {
  root: string;
  projectPath: string;
  accounts: readonly ProfileSyncAccountInput[];
  rulesSource?: RulesFile | null;
  approvedIds: readonly string[];
  rulesStrategy?: RulesStrategy;
  runner?: CommandRunner;
  baseEnv?: NodeJS.ProcessEnv;
  now?: () => Date;
}): Promise<ProfileSyncApplyResult> {
  const timestamp = (input.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backupDir = join(input.root, 'backups', 'profile-sync', timestamp);
  const approved = new Set(input.approvedIds);
  const strategy = input.rulesStrategy ?? 'copy';
  const { targets, servers, preview } = await planProfileTargets({
    projectPath: input.projectPath,
    accounts: input.accounts,
    ...(input.rulesSource !== undefined ? { rulesSource: input.rulesSource } : {}),
  });

  const appliedIds: string[] = [];
  const skippedIds: string[] = [];
  const accountById = new Map(input.accounts.map((account) => [account.id, account] as const));
  let backupIndex = 1;

  for (const planned of targets) {
    const { item } = planned;
    if (item.status === 'unchanged' || item.status === 'incompatible') {
      skippedIds.push(item.id);
      continue;
    }
    if ((item.status === 'update' || item.status === 'conflict') && !approved.has(item.id)) {
      skippedIds.push(item.id);
      continue;
    }

    if (item.scope === 'mcp' && item.provider === 'gemini') {
      const account = item.accountId ? accountById.get(item.accountId) : undefined;
      if (!account || !input.runner) {
        skippedIds.push(item.id);
        continue;
      }
      await backupExistingFile({ targetPath: planned.rawPath, backupDir, index: backupIndex++ });
      const env = { ...(input.baseEnv ?? process.env), HOME: account.homeDir };
      let okAll = true;
      for (const [name, server] of Object.entries(servers)) {
        const built = buildAgyMcpAddArgs(name, server);
        if ('incompatibleReason' in built) continue;
        const result = await input.runner.run({ command: 'agy', args: built.args, env });
        if ('notFound' in result || result.exitCode !== 0) {
          okAll = false;
        }
      }
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
        await writeAtomic(planned.rawPath, planned.rawAfter);
        appliedIds.push(item.id);
        continue;
      }
    }

    await writeAtomic(planned.rawPath, planned.rawAfter);
    appliedIds.push(item.id);
  }

  return { backupDir, appliedIds, skippedIds };
}
