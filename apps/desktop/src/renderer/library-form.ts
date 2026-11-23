import type { ProviderId } from '@inova/core/types';
import type { LibraryItem, LibraryItemKind, SaveLibraryItemInput } from '../shared/api';
import type { TranslationKey } from './i18n';

export const ENV_VALUE_EXAMPLE = '${MINHA_VARIAVEL}';
export const SECRET_HELP_EXAMPLE = '${GITHUB_TOKEN}';

export const MAX_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_COMMAND_LENGTH = 500;
export const MAX_ARGS = 50;
export const MAX_ARG_LENGTH = 1000;
export const MAX_URL_LENGTH = 2000;
export const MAX_SKILL_BYTES = 256 * 1024;

// REGEX: slug made of lowercase alphanumeric words joined by single hyphens
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// REGEX: whole value is one ${VAR} reference, optionally prefixed by a scheme word such as Bearer
const VARIABLE_REFERENCE = /^(?:[A-Za-z]+ )?\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface KeyValueRow {
  key: string;
  value: string;
}

export interface LibraryFormState {
  kind: LibraryItemKind;
  editing: boolean;
  enabled: boolean;
  id: string;
  name: string;
  description: string;
  skillContent: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: KeyValueRow[];
  headers: KeyValueRow[];
  label: string;
  provider: ProviderId;
  marketplace: string;
  pluginName: string;
  pluginPackage: boolean;
}

export type LibraryFormErrorCode =
  | 'id-invalid'
  | 'name-required'
  | 'name-too-long'
  | 'description-too-long'
  | 'content-required'
  | 'content-too-large'
  | 'command-required'
  | 'command-too-long'
  | 'args-too-many'
  | 'arg-too-long'
  | 'url-required'
  | 'url-invalid'
  | 'pair-key-required'
  | 'pair-key-duplicate'
  | 'pair-value-reference'
  | 'label-required'
  | 'plugin-name-required';

export const FORM_ERROR_KEYS: Record<LibraryFormErrorCode, TranslationKey> = {
  'id-invalid': 'library.error.idInvalid',
  'name-required': 'library.error.nameRequired',
  'name-too-long': 'library.error.nameTooLong',
  'description-too-long': 'library.error.descriptionTooLong',
  'content-required': 'library.error.contentRequired',
  'content-too-large': 'library.error.contentTooLarge',
  'command-required': 'library.error.commandRequired',
  'command-too-long': 'library.error.commandTooLong',
  'args-too-many': 'library.error.argsTooMany',
  'arg-too-long': 'library.error.argTooLong',
  'url-required': 'library.error.urlRequired',
  'url-invalid': 'library.error.urlInvalid',
  'pair-key-required': 'library.error.pairKeyRequired',
  'pair-key-duplicate': 'library.error.pairKeyDuplicate',
  'pair-value-reference': 'library.error.pairValueReference',
  'label-required': 'library.error.labelRequired',
  'plugin-name-required': 'library.error.pluginNameRequired',
};

export type LibraryFormResult =
  | { ok: true; input: SaveLibraryItemInput }
  | { ok: false; code: LibraryFormErrorCode; detail?: string };

export function isVariableReference(value: string): boolean {
  return VARIABLE_REFERENCE.test(value);
}

export function isLibrarySlug(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

export function emptyForm(kind: LibraryItemKind): LibraryFormState {
  return {
    kind,
    editing: false,
    enabled: true,
    id: '',
    name: '',
    description: '',
    skillContent: '',
    transport: kind === 'connector' ? 'http' : 'stdio',
    command: '',
    args: '',
    url: '',
    env: [],
    headers: [],
    label: '',
    provider: 'claude',
    marketplace: '',
    pluginName: '',
    pluginPackage: false,
  };
}

function rowsOf(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function formFromItem(item: LibraryItem): LibraryFormState {
  const base: LibraryFormState = {
    ...emptyForm(item.kind),
    editing: true,
    enabled: item.enabled,
    id: item.id,
    name: item.name,
    description: item.description ?? '',
  };
  switch (item.kind) {
    case 'skill':
      return base;
    case 'mcp': {
      const { definition } = item;
      if ('url' in definition) {
        return {
          ...base,
          transport: definition.type,
          url: definition.url,
          headers: rowsOf(definition.headers),
        };
      }
      return {
        ...base,
        transport: 'stdio',
        command: definition.command,
        args: (definition.args ?? []).join('\n'),
        env: rowsOf(definition.env),
      };
    }
    case 'connector':
      return {
        ...base,
        transport: item.definition.type,
        url: item.definition.url,
        headers: rowsOf(item.definition.headers),
        label: item.label,
      };
    case 'plugin':
      if ('format' in item.definition && item.definition.format === 'package') {
        return {
          ...base,
          pluginPackage: true,
          pluginName: item.name,
        };
      }
      return {
        ...base,
        pluginPackage: false,
        provider: item.definition.provider,
        marketplace: item.definition.marketplace ?? '',
        pluginName: item.definition.name,
      };
  }
}

type Failure = Extract<LibraryFormResult, { ok: false }>;

function failure(code: LibraryFormErrorCode, detail?: string): Failure {
  return detail === undefined ? { ok: false, code } : { ok: false, code, detail };
}

function isFailure<T>(value: T | Failure): value is Failure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}

function buildRecord(rows: readonly KeyValueRow[]): Record<string, string> | undefined | Failure {
  const seen = new Set<string>();
  const entries: [string, string][] = [];
  for (const row of rows) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (key === '' && value === '') continue;
    if (key === '') return failure('pair-key-required');
    if (seen.has(key)) return failure('pair-key-duplicate', key);
    if (!isVariableReference(value)) return failure('pair-value-reference', key);
    seen.add(key);
    entries.push([key, value]);
  }
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function buildArgs(text: string): string[] | Failure {
  const args = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (args.length > MAX_ARGS) return failure('args-too-many');
  if (args.some((arg) => arg.length > MAX_ARG_LENGTH)) return failure('arg-too-long');
  return args;
}

function validRemoteUrl(raw: string): string | Failure {
  const url = raw.trim();
  if (url === '') return failure('url-required');
  if (url.length > MAX_URL_LENGTH) return failure('url-invalid');
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : failure('url-invalid');
  } catch {
    return failure('url-invalid');
  }
}

type RemoteDefinition = { type: 'http' | 'sse'; url: string; headers?: Record<string, string> };

function buildRemote(form: LibraryFormState): RemoteDefinition | Failure {
  const url = validRemoteUrl(form.url);
  if (isFailure(url)) return url;
  const headers = buildRecord(form.headers);
  if (isFailure(headers)) return headers;
  const type = form.transport === 'sse' ? 'sse' : 'http';
  return { type, url, ...(headers ? { headers } : {}) };
}

function buildStdio(form: LibraryFormState) {
  const command = form.command.trim();
  if (command === '') return failure('command-required');
  if (command.length > MAX_COMMAND_LENGTH) return failure('command-too-long');
  const args = buildArgs(form.args);
  if (isFailure(args)) return args;
  const env = buildRecord(form.env);
  if (isFailure(env)) return env;
  return {
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
  };
}

function buildSkill(form: LibraryFormState): { content?: string } | Failure {
  if (form.skillContent.trim() === '') {
    return form.editing ? {} : failure('content-required');
  }
  if (new TextEncoder().encode(form.skillContent).length > MAX_SKILL_BYTES) {
    return failure('content-too-large');
  }
  return { content: form.skillContent };
}

function buildPlugin(form: LibraryFormState) {
  const name = form.pluginName.trim();
  if (name === '') return failure('plugin-name-required');
  const marketplace = form.marketplace.trim();
  return {
    provider: form.provider,
    ...(marketplace === '' ? {} : { marketplace }),
    name,
  };
}

function validateCommon(form: LibraryFormState): Failure | null {
  if (!isLibrarySlug(form.id.trim())) return failure('id-invalid');
  const name = form.name.trim();
  if (name === '') return failure('name-required');
  if (name.length > MAX_NAME_LENGTH) return failure('name-too-long');
  if (form.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    return failure('description-too-long');
  }
  return null;
}

interface CommonFields {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
}

function buildKind(form: LibraryFormState, common: CommonFields): LibraryFormResult {
  switch (form.kind) {
    case 'skill': {
      const skill = buildSkill(form);
      return isFailure(skill) ? skill : { ok: true, input: { ...common, kind: 'skill', ...skill } };
    }
    case 'mcp': {
      const definition = form.transport === 'stdio' ? buildStdio(form) : buildRemote(form);
      return isFailure(definition)
        ? definition
        : { ok: true, input: { ...common, kind: 'mcp', definition } };
    }
    case 'connector': {
      const label = form.label.trim();
      if (label === '') return failure('label-required');
      const definition = buildRemote(form);
      return isFailure(definition)
        ? definition
        : { ok: true, input: { ...common, kind: 'connector', definition, label } };
    }
    case 'plugin': {
      if (form.editing && form.pluginPackage) {
        return { ok: true, input: { ...common, kind: 'plugin' } };
      }
      const definition = buildPlugin(form);
      return isFailure(definition)
        ? definition
        : { ok: true, input: { ...common, kind: 'plugin', definition } };
    }
  }
}

export function buildSaveInput(form: LibraryFormState): LibraryFormResult {
  const invalid = validateCommon(form);
  if (invalid) return invalid;
  const description = form.description.trim();
  return buildKind(form, {
    id: form.id.trim(),
    name: form.name.trim(),
    description: description === '' ? null : description,
    enabled: form.enabled,
  });
}

export function toggleInput(item: LibraryItem, enabled: boolean): SaveLibraryItemInput {
  const common = { id: item.id, name: item.name, description: item.description, enabled };
  switch (item.kind) {
    case 'skill':
      return { ...common, kind: 'skill' };
    case 'mcp':
      return { ...common, kind: 'mcp', definition: item.definition };
    case 'connector':
      return { ...common, kind: 'connector', definition: item.definition, label: item.label };
    case 'plugin':
      return { ...common, kind: 'plugin', definition: item.definition };
  }
}
