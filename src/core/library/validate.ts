import type { McpHttpServer, McpServerConfig, McpStdioServer } from '../profile-sync.js';
import { isProviderId } from '../providers.js';
import { containsSecretLiteral, isSecretFlagArgument } from './credential-detect.js';
import type {
  LibraryItem,
  LibraryItemSource,
  PluginDefinition,
  PluginManifestFormat,
  PluginPackageCommandMeta,
  PluginPackageDefinition,
  PluginPackageSkillMeta,
  SkillDefinition,
} from './types.js';

export const MAX_PROJECT_DISABLED_ITEMS = 200;

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_COMMAND_LENGTH = 500;
const MAX_ARGS = 50;
const MAX_ARG_LENGTH = 1000;
const MAX_RECORD_ENTRIES = 50;
const MAX_RECORD_KEY_LENGTH = 100;
const MAX_URL_LENGTH = 2000;
const MAX_PACKAGE_ENTRIES = 100;
const MAX_PACKAGE_PATH_LENGTH = 255;
const MANIFEST_FORMATS: ReadonlySet<string> = new Set([
  'claude',
  'codex',
  'cursor',
  'antigravity',
  'generic',
]);

// REGEX: slug made of lowercase alphanumeric words joined by single hyphens
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// REGEX: whole value is one ${VAR} reference, optionally prefixed by a scheme word such as Bearer
const VARIABLE_REFERENCE = /^(?:[A-Za-z]+ )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
// REGEX: plugin or marketplace name that starts with an alphanumeric and has no separators
const REFERENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// REGEX: lowercase hexadecimal content hash
const SKILL_HASH = /^[a-f0-9]{8,128}$/;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export type LibraryItemValidation = { ok: true; item: LibraryItem } | { ok: false; error: string };

class InvalidLibraryItem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLibraryItem';
  }
}

function invalid(message: string): InvalidLibraryItem {
  return new InvalidLibraryItem(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${field} must be an object`);
  return value;
}

export function isLibraryId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

// REGEX: environment variable name
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// REGEX: HTTP header field name (RFC 9110 token)
const HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export { containsSecretLiteral, containsSecretShape } from './credential-detect.js';

function plainText(input: { value: unknown; field: string; min: number; max: number }): string {
  const { value, field, min, max } = input;
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw invalid(`${field} must be a string of ${min} to ${max} characters`);
  }
  if (containsSecretLiteral(value)) throw invalid(`${field} must not contain secrets`);
  return value;
}

function referenceRecord(input: {
  value: unknown;
  field: string;
  keyPattern: RegExp;
}): Record<string, string> {
  const { value, field, keyPattern } = input;
  const entries = Object.entries(requireRecord(value, field));
  if (entries.length > MAX_RECORD_ENTRIES) {
    throw invalid(`${field} must have at most ${MAX_RECORD_ENTRIES} entries`);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (key.length > MAX_RECORD_KEY_LENGTH || FORBIDDEN_KEYS.has(key) || !keyPattern.test(key)) {
      throw invalid(`${field} has an invalid key`);
    }
    if (containsSecretLiteral(key)) throw invalid(`${field} keys must not contain secrets`);
    if (typeof entry !== 'string' || !VARIABLE_REFERENCE.test(entry)) {
      throw invalid(`${field}.${key} must be a \${VAR} reference`);
    }
    result[key] = entry;
  }
  return result;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARGS) {
    throw invalid(`${field} must be an array of at most ${MAX_ARGS} strings`);
  }
  const args = value.map((entry: unknown, index) =>
    plainText({ value: entry, field: `${field}[${index}]`, min: 0, max: MAX_ARG_LENGTH }),
  );
  args.forEach((arg, index) => {
    const next = args[index + 1];
    if (next !== undefined && isSecretFlagArgument({ flag: arg, value: next })) {
      throw invalid(`${field}[${index + 1}] must be a \${VAR} reference after ${arg}`);
    }
  });
  return args;
}

function remoteUrl(value: unknown): string {
  const url = plainText({ value, field: 'definition.url', min: 1, max: MAX_URL_LENGTH });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('definition.url must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw invalid('definition.url must use http or https');
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    throw invalid('definition.url must not contain credentials or a fragment');
  }
  for (const [, queryValue] of parsed.searchParams) {
    if (!VARIABLE_REFERENCE.test(queryValue)) {
      throw invalid('definition.url query values must be ${VAR} references');
    }
  }
  return url;
}

function remoteDefinition(value: unknown): McpHttpServer {
  const record = requireRecord(value, 'definition');
  const type = record['type'];
  if (type !== 'http' && type !== 'sse') throw invalid('definition.type must be http or sse');
  const url = remoteUrl(record['url']);
  const rawHeaders = record['headers'];
  const headers =
    rawHeaders === undefined
      ? undefined
      : referenceRecord({
          value: rawHeaders,
          field: 'definition.headers',
          keyPattern: HEADER_KEY,
        });
  return { type, url, ...(headers ? { headers } : {}) };
}

function stdioDefinition(record: Record<string, unknown>): McpStdioServer {
  const command = plainText({
    value: record['command'],
    field: 'definition.command',
    min: 1,
    max: MAX_COMMAND_LENGTH,
  });
  const rawArgs = record['args'];
  const rawEnv = record['env'];
  const args = rawArgs === undefined ? undefined : stringArray(rawArgs, 'definition.args');
  const env =
    rawEnv === undefined
      ? undefined
      : referenceRecord({ value: rawEnv, field: 'definition.env', keyPattern: ENV_KEY });
  return {
    ...(record['type'] === 'stdio' ? { type: 'stdio' as const } : {}),
    command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
  };
}

function mcpDefinition(value: unknown): McpServerConfig {
  const record = requireRecord(value, 'definition');
  const type = record['type'];
  if (type === 'http' || type === 'sse') return remoteDefinition(record);
  if (type === undefined || type === 'stdio') return stdioDefinition(record);
  throw invalid('definition.type must be stdio, http or sse');
}

function skillDefinition(value: unknown): SkillDefinition {
  const hash = requireRecord(value, 'definition')['hash'];
  if (typeof hash !== 'string' || !SKILL_HASH.test(hash)) {
    throw invalid('definition.hash must be a lowercase hexadecimal hash');
  }
  return { hash };
}

function referenceName(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_NAME_LENGTH || !REFERENCE_NAME.test(value)) {
    throw invalid(`${field} must be a plain name of at most ${MAX_NAME_LENGTH} characters`);
  }
  if (containsSecretLiteral(value)) throw invalid(`${field} must not contain secrets`);
  return value;
}

function packagePath(value: unknown, field: string): string {
  const path = plainText({ value, field, min: 1, max: MAX_PACKAGE_PATH_LENGTH });
  if (
    path.includes('\0') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw invalid(`${field} must be a safe relative path`);
  }
  return path;
}

function packageDescription(value: unknown, field: string): string | null {
  if (value === null) return null;
  return plainText({ value, field, min: 0, max: MAX_DESCRIPTION_LENGTH });
}

function packageSkills(value: unknown): PluginPackageSkillMeta[] {
  if (!Array.isArray(value) || value.length > MAX_PACKAGE_ENTRIES) {
    throw invalid(`definition.skills must be an array of at most ${MAX_PACKAGE_ENTRIES} entries`);
  }
  return value.map((entry: unknown, index) => {
    const record = requireRecord(entry, `definition.skills[${index}]`);
    const id = record['id'];
    if (!isLibraryId(id)) {
      throw invalid(`definition.skills[${index}].id must be a slug of at most 64 characters`);
    }
    return {
      id,
      name: plainText({
        value: record['name'],
        field: `definition.skills[${index}].name`,
        min: 1,
        max: MAX_NAME_LENGTH,
      }),
      description: packageDescription(
        record['description'],
        `definition.skills[${index}].description`,
      ),
      path: packagePath(record['path'], `definition.skills[${index}].path`),
    };
  });
}

function packageCommands(value: unknown): PluginPackageCommandMeta[] {
  if (!Array.isArray(value) || value.length > MAX_PACKAGE_ENTRIES) {
    throw invalid(`definition.commands must be an array of at most ${MAX_PACKAGE_ENTRIES} entries`);
  }
  return value.map((entry: unknown, index) => {
    const record = requireRecord(entry, `definition.commands[${index}]`);
    const name = plainText({
      value: record['name'],
      field: `definition.commands[${index}].name`,
      min: 1,
      max: MAX_NAME_LENGTH,
    });
    if (name.includes('/') || /\s/.test(name)) {
      throw invalid(`definition.commands[${index}].name must not contain spaces or slashes`);
    }
    return {
      name,
      description: packageDescription(
        record['description'],
        `definition.commands[${index}].description`,
      ),
      path: packagePath(record['path'], `definition.commands[${index}].path`),
    };
  });
}

function packageMcpServers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_RECORD_ENTRIES) {
    throw invalid(
      `definition.mcpServers must be an array of at most ${MAX_RECORD_ENTRIES} entries`,
    );
  }
  return value.map((entry: unknown, index) =>
    plainText({
      value: entry,
      field: `definition.mcpServers[${index}]`,
      min: 1,
      max: MAX_NAME_LENGTH,
    }),
  );
}

function pluginPackageDefinition(record: Record<string, unknown>): PluginPackageDefinition {
  const manifestFormat = record['manifestFormat'];
  if (typeof manifestFormat !== 'string' || !MANIFEST_FORMATS.has(manifestFormat)) {
    throw invalid('definition.manifestFormat must be a supported plugin format');
  }
  const hash = record['hash'];
  if (typeof hash !== 'string' || !SKILL_HASH.test(hash)) {
    throw invalid('definition.hash must be a lowercase hexadecimal hash');
  }
  const rawVersion = record['version'];
  const version =
    rawVersion === undefined
      ? undefined
      : plainText({ value: rawVersion, field: 'definition.version', min: 1, max: 64 });
  const rawMcp = record['mcpServers'];
  const mcpServers = rawMcp === undefined ? undefined : packageMcpServers(rawMcp);
  return {
    format: 'package',
    manifestFormat: manifestFormat as PluginManifestFormat,
    ...(version === undefined ? {} : { version }),
    hash,
    skills: packageSkills(record['skills']),
    commands: packageCommands(record['commands']),
    ...(mcpServers === undefined ? {} : { mcpServers }),
  };
}

function pluginDefinition(value: unknown): PluginDefinition {
  const record = requireRecord(value, 'definition');
  if (record['format'] === 'package') return pluginPackageDefinition(record);
  if (record['format'] !== undefined && record['format'] !== 'recipe') {
    throw invalid('definition.format must be recipe or package');
  }
  const provider = record['provider'];
  if (typeof provider !== 'string' || !isProviderId(provider)) {
    throw invalid('definition.provider must be a known provider');
  }
  const marketplace = record['marketplace'];
  return {
    ...(record['format'] === 'recipe' ? { format: 'recipe' as const } : {}),
    provider,
    ...(marketplace === undefined
      ? {}
      : { marketplace: referenceName(marketplace, 'definition.marketplace') }),
    name: referenceName(record['name'], 'definition.name'),
  };
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isItemSource(value: unknown): value is LibraryItemSource {
  return value === 'created' || value === 'imported';
}

function commonFields(record: Record<string, unknown>) {
  const { id, description, enabled, source, updatedAt } = record;
  if (!isLibraryId(id)) throw invalid('id must be a slug of at most 64 characters');
  if (typeof enabled !== 'boolean') throw invalid('enabled must be a boolean');
  if (!isItemSource(source)) throw invalid('source must be created or imported');
  if (!isIsoDate(updatedAt)) throw invalid('updatedAt must be an ISO date string');
  return {
    id,
    name: plainText({ value: record['name'], field: 'name', min: 1, max: MAX_NAME_LENGTH }),
    description:
      description === null
        ? null
        : plainText({
            value: description,
            field: 'description',
            min: 0,
            max: MAX_DESCRIPTION_LENGTH,
          }),
    enabled,
    source,
    updatedAt,
  };
}

function buildItem(input: unknown): LibraryItem {
  const record = requireRecord(input, 'item');
  const common = commonFields(record);
  switch (record['kind']) {
    case 'skill':
      return { ...common, kind: 'skill', definition: skillDefinition(record['definition']) };
    case 'mcp':
      return { ...common, kind: 'mcp', definition: mcpDefinition(record['definition']) };
    case 'connector':
      return {
        ...common,
        kind: 'connector',
        definition: remoteDefinition(record['definition']),
        label: plainText({ value: record['label'], field: 'label', min: 1, max: MAX_NAME_LENGTH }),
      };
    case 'plugin':
      return { ...common, kind: 'plugin', definition: pluginDefinition(record['definition']) };
    default:
      throw invalid('kind must be skill, mcp, connector or plugin');
  }
}

export function validateLibraryItem(input: unknown): LibraryItemValidation {
  try {
    return { ok: true, item: buildItem(input) };
  } catch (error: unknown) {
    if (error instanceof InvalidLibraryItem) return { ok: false, error: error.message };
    throw error;
  }
}
