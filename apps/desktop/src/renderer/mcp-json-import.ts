import { containsSecretLiteral, isSecretFlagArgument } from '@inova/core/library/credential-detect';
import type { SaveLibraryItemInput } from '../shared/api';
import type { TranslationKey } from './i18n';
import {
  MAX_ARG_LENGTH,
  MAX_ARGS,
  MAX_COMMAND_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  isLibrarySlug,
  isVariableReference,
} from './library-form';

export const MAX_IMPORT_JSON_CHARS = 200_000;
export const MAX_IMPORT_SERVERS = 50;
const MAX_RECORD_ENTRIES = 50;

// REGEX: env var name
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
// REGEX: HTTP header name token
const HEADER_KEY = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// REGEX: bare $NAME reference, optionally after a scheme word such as Bearer
const BARE_REFERENCE = /^((?:[A-Za-z]+ )?)\$([A-Za-z_][A-Za-z0-9_]*)$/;
// REGEX: auth scheme word at the start of a literal header value
const AUTH_SCHEME = /^(Bearer|Basic|Token) /i;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const HTTP_TYPES: ReadonlySet<string> = new Set(['http', 'streamable-http', 'streamablehttp']);
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'transport',
  'url',
  'serverUrl',
  'headers',
  'command',
  'args',
  'env',
]);

export type ImportParseErrorCode = 'empty' | 'too-large' | 'invalid-json' | 'unknown-shape';

export type ImportEntryErrorCode =
  | 'too-many'
  | 'not-object'
  | 'id-invalid'
  | 'duplicate-id'
  | 'unsupported-type'
  | 'ambiguous'
  | 'unknown-server'
  | 'url-missing'
  | 'url-invalid'
  | 'url-credentials'
  | 'command-missing'
  | 'command-too-long'
  | 'args-invalid'
  | 'record-invalid'
  | 'secret-literal';

export type ImportWarningCode = 'id-normalized' | 'ignored-fields';

export interface ImportReplacement {
  scope: 'header' | 'env' | 'url';
  key: string;
  /** Name of the environment variable the user must define. */
  variable: string;
}

export interface ImportEntryOk {
  ok: true;
  id: string;
  rawName: string;
  kind: 'connector' | 'mcp';
  /** URL for remote servers, command for stdio servers. */
  target: string;
  input: SaveLibraryItemInput;
  replacements: ImportReplacement[];
  warnings: { code: ImportWarningCode; detail?: string }[];
}

export interface ImportEntryFailed {
  ok: false;
  id: string;
  rawName: string;
  error: ImportEntryErrorCode;
  detail?: string;
}

export type ImportEntry = ImportEntryOk | ImportEntryFailed;

export type ImportParseResult =
  | { ok: false; error: ImportParseErrorCode }
  /** `needsName` is true when the JSON is one server without a name and no name was given. */
  | { ok: true; needsName: boolean; entries: ImportEntry[] };

export interface ImportParseOptions {
  /** Id typed by the user for a single unnamed server. */
  name?: string;
  existingIds?: readonly string[];
}

export const IMPORT_PARSE_ERROR_KEYS: Record<ImportParseErrorCode, TranslationKey> = {
  empty: 'connectors.json.err.empty',
  'too-large': 'connectors.json.err.tooLarge',
  'invalid-json': 'connectors.json.err.invalidJson',
  'unknown-shape': 'connectors.json.err.unknownShape',
};

export const IMPORT_ENTRY_ERROR_KEYS: Record<ImportEntryErrorCode, TranslationKey> = {
  'too-many': 'connectors.json.entry.tooMany',
  'not-object': 'connectors.json.entry.notObject',
  'id-invalid': 'connectors.json.entry.idInvalid',
  'duplicate-id': 'connectors.json.entry.duplicateId',
  'unsupported-type': 'connectors.json.entry.unsupportedType',
  ambiguous: 'connectors.json.entry.ambiguous',
  'unknown-server': 'connectors.json.entry.unknownServer',
  'url-missing': 'connectors.json.entry.urlMissing',
  'url-invalid': 'connectors.json.entry.urlInvalid',
  'url-credentials': 'connectors.json.entry.urlCredentials',
  'command-missing': 'connectors.json.entry.commandMissing',
  'command-too-long': 'connectors.json.entry.commandTooLong',
  'args-invalid': 'connectors.json.entry.argsInvalid',
  'record-invalid': 'connectors.json.entry.recordInvalid',
  'secret-literal': 'connectors.json.entry.secretLiteral',
};

export const IMPORT_WARNING_KEYS: Record<ImportWarningCode, TranslationKey> = {
  'id-normalized': 'connectors.json.warn.idNormalized',
  'ignored-fields': 'connectors.json.warn.ignoredFields',
};

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeServer(value: unknown): value is Json {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['command'] === 'string' ||
    typeof value['url'] === 'string' ||
    typeof value['serverUrl'] === 'string'
  );
}

function hasServerMarkers(value: Json): boolean {
  const type = value['type'];
  return (
    looksLikeServer(value) ||
    (typeof type === 'string' && (type === 'stdio' || type === 'sse' || HTTP_TYPES.has(type)))
  );
}

type Located = { named: Json } | { single: Json } | null;

function locateServers(root: Json): Located {
  const direct = root['mcpServers'] ?? root['servers'];
  if (isPlainObject(direct)) return { named: direct };
  const nested = root['mcp'];
  if (isPlainObject(nested) && isPlainObject(nested['servers'])) {
    return { named: nested['servers'] };
  }
  if (hasServerMarkers(root)) return { single: root };
  const values = Object.values(root);
  if (values.length > 0 && values.every((v) => isPlainObject(v) && hasServerMarkers(v))) {
    return { named: root };
  }
  return null;
}

export function normalizeServerId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '');
}

function envName(text: string): string {
  const upper = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(upper) ? `MCP_${upper}` : upper;
}

class Failure extends Error {
  constructor(
    readonly code: ImportEntryErrorCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

class VariableAllocator {
  private readonly used = new Set<string>();

  constructor(readonly id: string) {}

  reserve(base: string): string {
    let name = base;
    let counter = 2;
    while (this.used.has(name)) {
      name = `${base}_${counter}`;
      counter += 1;
    }
    this.used.add(name);
    return name;
  }

  headerVariable(key: string): string {
    const prefix = envName(this.id);
    const suffix = key.toLowerCase() === 'authorization' ? 'TOKEN' : envName(key);
    return this.reserve(`${prefix}_${suffix === '' ? 'VALUE' : suffix}`);
  }
}

function toReference(input: {
  value: string;
  scope: ImportReplacement['scope'];
  key: string;
  variable: () => string;
  replacements: ImportReplacement[];
}): string {
  const { value, scope, key, variable, replacements } = input;
  const trimmed = value.trim();
  if (isVariableReference(trimmed)) return trimmed;
  const bare = BARE_REFERENCE.exec(trimmed);
  if (bare) {
    const name = bare[2] ?? '';
    replacements.push({ scope, key, variable: name });
    return `${bare[1] ?? ''}\${${name}}`;
  }
  const name = variable();
  replacements.push({ scope, key, variable: name });
  const scheme = scope === 'header' ? AUTH_SCHEME.exec(trimmed)?.[1] : undefined;
  return scheme === undefined ? `\${${name}}` : `${scheme} \${${name}}`;
}

function buildRecord(input: {
  raw: unknown;
  field: string;
  scope: 'header' | 'env';
  allocator: VariableAllocator;
  replacements: ImportReplacement[];
}): Record<string, string> | undefined {
  const { raw, field, scope, allocator, replacements } = input;
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) throw new Failure('record-invalid', field);
  const entries = Object.entries(raw);
  if (entries.length > MAX_RECORD_ENTRIES) throw new Failure('record-invalid', field);
  if (entries.length === 0) return undefined;
  const keyPattern = scope === 'header' ? HEADER_KEY : ENV_KEY;
  const result: [string, string][] = [];
  for (const [key, value] of entries) {
    if (key.length > 100 || FORBIDDEN_KEYS.has(key) || !keyPattern.test(key)) {
      throw new Failure('record-invalid', `${field}.${key}`);
    }
    if (typeof value !== 'string') throw new Failure('record-invalid', `${field}.${key}`);
    if (containsSecretLiteral(key)) throw new Failure('secret-literal', `${field} key ${key}`);
    const variable = () =>
      scope === 'env' ? allocator.reserve(key) : allocator.headerVariable(key);
    result.push([key, toReference({ value, scope, key, variable, replacements })]);
  }
  return Object.fromEntries(result);
}

function buildUrl(input: {
  raw: unknown;
  allocator: VariableAllocator;
  replacements: ImportReplacement[];
}): string {
  const { raw, allocator, replacements } = input;
  if (typeof raw !== 'string' || raw.trim() === '') throw new Failure('url-missing');
  const url = raw.trim();
  if (url.length > MAX_URL_LENGTH) throw new Failure('url-invalid');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Failure('url-invalid');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Failure('url-invalid');
  }
  if (parsed.username !== '' || parsed.password !== '') throw new Failure('url-credentials');
  if (parsed.hash !== '') throw new Failure('url-invalid');
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const pairs = url
    .slice(queryStart + 1)
    .split('&')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      const reference = toReference({
        value,
        scope: 'url',
        key,
        variable: () => allocator.reserve(`${envName(allocator.id)}_${envName(key) || 'VALUE'}`),
        replacements,
      });
      return `${key}=${reference}`;
    });
  return pairs.length === 0 ? base : `${base}?${pairs.join('&')}`;
}

function buildArgs(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_ARGS) throw new Failure('args-invalid');
  const args = raw.map((arg: unknown) => {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH) throw new Failure('args-invalid');
    return arg;
  });
  args.forEach((arg, index) => {
    const next = args[index + 1];
    if (containsSecretLiteral(arg)) throw new Failure('secret-literal', `args[${index}]`);
    if (next !== undefined && isSecretFlagArgument({ flag: arg, value: next })) {
      throw new Failure('secret-literal', `args[${index + 1}]`);
    }
  });
  return args.length === 0 ? undefined : args;
}

function transportOf(server: Json): 'remote-http' | 'remote-sse' | 'stdio' {
  const rawType = server['type'] ?? server['transport'];
  const type = typeof rawType === 'string' ? rawType.toLowerCase() : undefined;
  if (rawType !== undefined && type === undefined) throw new Failure('unsupported-type');
  const hasUrl = server['url'] !== undefined || server['serverUrl'] !== undefined;
  const hasCommand = server['command'] !== undefined;
  if (type === 'stdio') {
    if (!hasCommand) throw new Failure('command-missing');
    return 'stdio';
  }
  if (type !== undefined) {
    if (type === 'sse') return 'remote-sse';
    if (HTTP_TYPES.has(type)) return 'remote-http';
    throw new Failure('unsupported-type', type);
  }
  if (hasUrl && hasCommand) throw new Failure('ambiguous');
  if (hasCommand) return 'stdio';
  if (hasUrl) return 'remote-http';
  throw new Failure('unknown-server');
}

function ignoredFields(server: Json): string | undefined {
  const extra = Object.keys(server).filter((key) => !KNOWN_FIELDS.has(key));
  return extra.length === 0 ? undefined : extra.slice(0, 10).join(', ');
}

function buildEntry(input: { id: string; rawName: string; server: Json }): ImportEntryOk {
  const { id, rawName, server } = input;
  const allocator = new VariableAllocator(id);
  const replacements: ImportReplacement[] = [];
  const warnings: ImportEntryOk['warnings'] = [];
  const ignored = ignoredFields(server);
  if (ignored !== undefined) warnings.push({ code: 'ignored-fields', detail: ignored });
  const trimmedName = rawName.trim().slice(0, MAX_NAME_LENGTH);
  const name = trimmedName === '' || containsSecretLiteral(trimmedName) ? id : trimmedName;
  const common = { id, name, description: null, enabled: true };
  const transport = transportOf(server);

  if (transport === 'stdio') {
    const command = server['command'];
    if (typeof command !== 'string' || command.trim() === '') throw new Failure('command-missing');
    if (command.trim().length > MAX_COMMAND_LENGTH) throw new Failure('command-too-long');
    if (containsSecretLiteral(command)) throw new Failure('secret-literal', 'command');
    const args = buildArgs(server['args']);
    const env = buildRecord({
      raw: server['env'],
      field: 'env',
      scope: 'env',
      allocator,
      replacements,
    });
    const definition = {
      command: command.trim(),
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
    };
    return {
      ok: true,
      id,
      rawName,
      kind: 'mcp',
      target: definition.command,
      input: { ...common, kind: 'mcp', definition },
      replacements,
      warnings,
    };
  }

  const url = buildUrl({ raw: server['url'] ?? server['serverUrl'], allocator, replacements });
  const headers = buildRecord({
    raw: server['headers'],
    field: 'headers',
    scope: 'header',
    allocator,
    replacements,
  });
  if (containsSecretLiteral(url)) throw new Failure('secret-literal', 'url');
  const definition = {
    type: transport === 'remote-sse' ? ('sse' as const) : ('http' as const),
    url,
    ...(headers ? { headers } : {}),
  };
  return {
    ok: true,
    id,
    rawName,
    kind: 'connector',
    target: url,
    input: { ...common, kind: 'connector', definition, label: name },
    replacements,
    warnings,
  };
}

function resolveId(input: {
  rawName: string;
  strict: boolean;
}): { id: string; normalized: boolean } | null {
  const { rawName, strict } = input;
  const trimmed = rawName.trim();
  if (isLibrarySlug(trimmed)) return { id: trimmed, normalized: false };
  if (strict) return null;
  const id = normalizeServerId(trimmed);
  return id !== '' && isLibrarySlug(id) ? { id, normalized: true } : null;
}

function failed(rawName: string, error: ImportEntryErrorCode, detail?: string): ImportEntryFailed {
  return { ok: false, id: rawName, rawName, error, ...(detail === undefined ? {} : { detail }) };
}

function processEntries(input: {
  pairs: readonly [string, unknown][];
  strictIds: boolean;
  existing: ReadonlySet<string>;
}): ImportEntry[] {
  const seen = new Set<string>();
  return input.pairs.map(([rawName, server]) => {
    const resolved = resolveId({ rawName, strict: input.strictIds });
    if (!resolved) return failed(rawName, 'id-invalid');
    const { id, normalized } = resolved;
    if (seen.has(id)) return failed(rawName, 'duplicate-id', 'json');
    seen.add(id);
    if (input.existing.has(id)) return { ...failed(rawName, 'duplicate-id', 'library'), id };
    if (!isPlainObject(server)) return { ...failed(rawName, 'not-object'), id };
    try {
      const entry = buildEntry({ id, rawName, server });
      if (normalized) entry.warnings.unshift({ code: 'id-normalized', detail: id });
      return entry;
    } catch (error: unknown) {
      if (error instanceof Failure) return { ...failed(rawName, error.code, error.detail), id };
      throw error;
    }
  });
}

/**
 * Parses pasted MCP JSON into per-server library save inputs. Pure: no I/O.
 * Literal header, env and URL query values never reach the saved input. The library stores only
 * `${VAR}` references, so each literal becomes a reference and is reported in `replacements`.
 * Literal secrets in `command` or `args` cannot be replaced safely, so the entry fails.
 */
export function parseMcpJson(text: string, options: ImportParseOptions = {}): ImportParseResult {
  if (text.trim() === '') return { ok: false, error: 'empty' };
  if (text.length > MAX_IMPORT_JSON_CHARS) return { ok: false, error: 'too-large' };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  if (!isPlainObject(root)) return { ok: false, error: 'unknown-shape' };
  const located = locateServers(root);
  if (located === null) {
    return { ok: false, error: Object.keys(root).length === 0 ? 'empty' : 'unknown-shape' };
  }
  const existing = new Set(options.existingIds ?? []);

  if ('single' in located) {
    const name = options.name?.trim() ?? '';
    if (name === '') return { ok: true, needsName: true, entries: [] };
    return {
      ok: true,
      needsName: false,
      entries: processEntries({ pairs: [[name, located.single]], strictIds: true, existing }),
    };
  }

  const pairs = Object.entries(located.named);
  if (pairs.length === 0) return { ok: false, error: 'empty' };
  if (pairs.length > MAX_IMPORT_SERVERS) {
    return { ok: true, needsName: false, entries: [failed('*', 'too-many', String(pairs.length))] };
  }
  return {
    ok: true,
    needsName: false,
    entries: processEntries({ pairs, strictIds: false, existing }),
  };
}
