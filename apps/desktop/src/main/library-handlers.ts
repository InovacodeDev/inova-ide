import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { serialize } from '@inova/core/capabilities/file-edit';
import {
  buildPluginInstallRecipe,
  importLibraryZip,
  installSkillFromText,
  isPluginPackage,
  LibraryCorruptError,
  LibraryValidationError,
  loadLibrary,
  loadLibraryWithInvalid,
  MAX_PROJECT_DISABLED_ITEMS,
  MAX_ZIP_BYTES,
  removeLibraryItem,
  saveLibraryItem,
  SkillValidationError,
  validateLibraryItem,
  ZipError,
  ZipImportError,
} from '@inova/core/library/index';
import type { LibraryItem, LibraryItemSource, ZipImportResult } from '@inova/core/library/index';
import {
  PathNotFoundError,
  removeProjectLibraryBinding,
  setProjectLibraryBinding,
  setProjectLibraryOverride,
} from '@inova/core/projects';
import { applyProfileSync, previewProfileSync } from '@inova/core/profile-sync';
import type {
  ProfileSyncAccountInput,
  ProfileSyncApplyResult,
  ProfileSyncLibraryInput,
  ProfileSyncPreview,
  ProfileSyncScope,
} from '@inova/core/profile-sync';
import type { CommandRunner } from '@inova/core/providers';
import { loadStore } from '@inova/core/store';
import type { Account, ProjectLibraryBinding } from '@inova/core/types';
import type { LibraryListing, Result } from '../shared/api.js';
import {
  fail,
  ok,
  parseApplyLibrarySync,
  parseImportLibraryZip,
  parsePreviewLibrarySync,
  parseRemoveLibraryItem,
  parseRemoveProjectLibraryBinding,
  parseSaveLibraryItem,
  parseSetProjectLibraryBinding,
  parseSetProjectOverride,
  validated,
} from './validation.js';
import type {
  ParsedImportLibraryZip,
  ParsedLibrarySyncSelection,
  ParsedSaveLibraryItem,
  ParsedSetProjectLibraryBinding,
} from './validation.js';

export interface LibraryHandlers {
  listLibrary(): Promise<Result<LibraryListing>>;
  saveLibraryItem(input: unknown): Promise<Result<LibraryItem>>;
  pickLibraryZip(): Promise<Result<string | null>>;
  importLibraryZip(input: unknown): Promise<Result<ZipImportResult>>;
  removeLibraryItem(input: unknown): Promise<Result<{ removed: boolean }>>;
  setProjectOverride(input: unknown): Promise<Result<{ disabled: string[] }>>;
  setProjectLibraryBinding(input: unknown): Promise<Result<{ bindings: ProjectLibraryBinding[] }>>;
  removeProjectLibraryBinding(
    input: unknown,
  ): Promise<Result<{ bindings: ProjectLibraryBinding[] }>>;
  previewLibrarySync(input: unknown): Promise<Result<ProfileSyncPreview>>;
  applyLibrarySync(input: unknown): Promise<Result<ProfileSyncApplyResult>>;
}

export interface LibraryHandlerDeps {
  root: string;
  baseEnv: () => Promise<NodeJS.ProcessEnv>;
  runner: CommandRunner;
  pickLibraryZip?: () => Promise<string | null>;
}

interface SyncContext {
  projectPath: string;
  accounts: ProfileSyncAccountInput[];
  library: ProfileSyncLibraryInput;
}

const LIBRARY_SYNC_SCOPES: readonly ProfileSyncScope[] = ['mcp', 'skill'];
const PROVISIONAL_SKILL_HASH = '0'.repeat(64);
const PROJECT_NOT_FOUND = 'Projeto não encontrado.';
const ACCOUNT_NOT_FOUND = 'Conta não encontrada.';
const KIND_CONFLICT = 'Já existe um item com este id de outro tipo.';
const SKILL_NEEDS_CONTENT = 'Uma skill nova exige o conteúdo do SKILL.md.';
const PLUGIN_NEEDS_DEFINITION = 'Um plugin novo exige definição.';
const LIBRARY_BINDING_ITEM_NOT_FOUND = 'Skill ou plugin não encontrado na biblioteca.';
const ZIP_PICK_UNAVAILABLE = 'Seleção de arquivo ZIP não está disponível.';
const ZIP_FILE_MISSING = 'Arquivo ZIP não encontrado.';

function toSyncAccount(account: Account): ProfileSyncAccountInput {
  const { id, provider, label, homeDir, disabledCapabilities } = account;
  return {
    id,
    provider,
    label,
    homeDir,
    ...(disabledCapabilities ? { disabledCapabilities } : {}),
  };
}

function candidateOf(input: {
  parsed: ParsedSaveLibraryItem;
  definition: unknown;
  source: LibraryItemSource;
}): unknown {
  const { parsed, definition, source } = input;
  return {
    id: parsed.id,
    kind: parsed.kind,
    name: parsed.name,
    description: parsed.description,
    enabled: parsed.enabled,
    source,
    definition,
    updatedAt: new Date().toISOString(),
    ...(parsed.label === undefined ? {} : { label: parsed.label }),
  };
}

function validCandidate(input: {
  parsed: ParsedSaveLibraryItem;
  definition: unknown;
  source: LibraryItemSource;
}): LibraryItem {
  const checked = validateLibraryItem(candidateOf(input));
  if (!checked.ok) throw new LibraryValidationError(checked.error);
  return checked.item;
}

export function createLibraryHandlers(deps: LibraryHandlerDeps): LibraryHandlers {
  const { root } = deps;
  const corruptMessage = `A biblioteca está corrompida. Restaure um backup em ${join(root, 'backups', 'library')}.`;
  const lockKey = join(root, 'library', '.handlers-lock');

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => serialize(lockKey, work);

  async function guardLibrary<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof LibraryCorruptError) return fail(corruptMessage);
      if (
        error instanceof LibraryValidationError ||
        error instanceof SkillValidationError ||
        error instanceof ZipError ||
        error instanceof ZipImportError ||
        error instanceof PathNotFoundError
      ) {
        return fail(error.message);
      }
      throw error;
    }
  }

  function persist(input: {
    parsed: ParsedSaveLibraryItem;
    definition: unknown;
    source: LibraryItemSource;
  }): Promise<LibraryItem> {
    return saveLibraryItem({ root, item: validCandidate(input) });
  }

  async function saveItem(parsed: ParsedSaveLibraryItem): Promise<Result<LibraryItem>> {
    const existing = (await loadLibrary(root)).items.find((item) => item.id === parsed.id);
    if (existing && existing.kind !== parsed.kind) return fail(KIND_CONFLICT);
    const source: LibraryItemSource = existing?.source ?? 'created';
    if (parsed.kind === 'plugin' && parsed.definition === undefined) {
      if (!existing) return fail(PLUGIN_NEEDS_DEFINITION);
      return ok(await persist({ parsed, definition: existing.definition, source }));
    }
    if (parsed.kind !== 'skill') {
      return ok(await persist({ parsed, definition: parsed.definition, source }));
    }
    if (parsed.content === undefined) {
      if (!existing) return fail(SKILL_NEEDS_CONTENT);
      return ok(await persist({ parsed, definition: existing.definition, source }));
    }
    validCandidate({ parsed, definition: { hash: PROVISIONAL_SKILL_HASH }, source });
    const { hash } = await installSkillFromText({
      root,
      id: parsed.id,
      content: parsed.content,
    });
    return ok(await persist({ parsed, definition: { hash }, source }));
  }

  async function importZip(parsed: ParsedImportLibraryZip): Promise<Result<ZipImportResult>> {
    let info;
    try {
      info = await stat(parsed.zipPath);
    } catch {
      return fail(ZIP_FILE_MISSING);
    }
    if (!info.isFile()) return fail(ZIP_FILE_MISSING);
    if (info.size > MAX_ZIP_BYTES) {
      return fail(`O arquivo ZIP excede o limite de ${MAX_ZIP_BYTES} bytes.`);
    }
    const buffer = await readFile(parsed.zipPath);
    return ok(
      await importLibraryZip({
        root,
        buffer,
        fileName: basename(parsed.zipPath),
        ...(parsed.expectedKind === undefined ? {} : { expectedKind: parsed.expectedKind }),
        ...(parsed.idOverride === undefined ? {} : { idOverride: parsed.idOverride }),
      }),
    );
  }

  async function setBinding(
    parsed: ParsedSetProjectLibraryBinding,
  ): Promise<Result<{ bindings: ProjectLibraryBinding[] }>> {
    const store = await loadStore(root);
    if (!store.projects.some((item) => item.id === parsed.projectId))
      return fail(PROJECT_NOT_FOUND);
    const item = (await loadLibrary(root)).items.find((entry) => entry.id === parsed.itemId);
    if (!item || (item.kind !== 'skill' && item.kind !== 'plugin')) {
      return fail(LIBRARY_BINDING_ITEM_NOT_FOUND);
    }
    const updated = await setProjectLibraryBinding({ root, ...parsed });
    return ok({ bindings: updated.libraryBindings ?? [] });
  }

  async function removeBinding(input: {
    projectId: string;
    itemId: string;
  }): Promise<Result<{ bindings: ProjectLibraryBinding[] }>> {
    const store = await loadStore(root);
    if (!store.projects.some((item) => item.id === input.projectId)) return fail(PROJECT_NOT_FOUND);
    const updated = await removeProjectLibraryBinding({ root, ...input });
    return ok({ bindings: updated.libraryBindings ?? [] });
  }

  async function setOverride(input: {
    projectId: string;
    itemId: string;
    disabled: boolean;
  }): Promise<Result<{ disabled: string[] }>> {
    const { projectId, itemId, disabled } = input;
    const project = (await loadStore(root)).projects.find((item) => item.id === projectId);
    if (!project) return fail(PROJECT_NOT_FOUND);
    const current = project.libraryOverrides?.disabled ?? [];
    if (disabled && !current.includes(itemId) && current.length >= MAX_PROJECT_DISABLED_ITEMS) {
      return fail(
        `Um projeto aceita até ${MAX_PROJECT_DISABLED_ITEMS} itens da biblioteca desligados.`,
      );
    }
    const updated = await setProjectLibraryOverride({ root, projectId, itemId, disabled });
    return ok({ disabled: updated.libraryOverrides?.disabled ?? [] });
  }

  async function loadSyncContext(
    selection: ParsedLibrarySyncSelection,
  ): Promise<Result<SyncContext>> {
    const { projectId, accountIds } = selection;
    const store = await loadStore(root);
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return fail(PROJECT_NOT_FOUND);
    if (accountIds?.some((id) => !store.accounts.some((account) => account.id === id))) {
      return fail(ACCOUNT_NOT_FOUND);
    }
    const selected = accountIds
      ? store.accounts.filter((account) => accountIds.includes(account.id))
      : store.accounts;
    const { items } = await loadLibrary(root);
    return ok({
      projectPath: project.path,
      accounts: selected.map(toSyncAccount),
      library: { items, projectDisabled: project.libraryOverrides?.disabled ?? [] },
    });
  }

  return {
    listLibrary: () =>
      guardLibrary(async () => {
        const { library, invalid } = await loadLibraryWithInvalid(root);
        const { items } = library;
        const recipes = items.flatMap((item) =>
          item.kind === 'plugin' && !isPluginPackage(item.definition)
            ? [[item.id, buildPluginInstallRecipe(item.definition)] as const]
            : [],
        );
        return ok({
          items,
          pluginRecipes: Object.fromEntries(recipes),
          invalidItems: invalid,
        });
      }),
    saveLibraryItem: (input) =>
      validated(input, parseSaveLibraryItem, (parsed) =>
        guardLibrary(() => exclusive(() => saveItem(parsed))),
      ),
    pickLibraryZip: () =>
      guardLibrary(async () => {
        if (!deps.pickLibraryZip) return fail(ZIP_PICK_UNAVAILABLE);
        return ok(await deps.pickLibraryZip());
      }),
    importLibraryZip: (input) =>
      validated(input, parseImportLibraryZip, (parsed) =>
        guardLibrary(() => exclusive(() => importZip(parsed))),
      ),
    removeLibraryItem: (input) =>
      validated(input, parseRemoveLibraryItem, ({ id }) =>
        guardLibrary(() => exclusive(async () => ok(await removeLibraryItem({ root, id })))),
      ),
    setProjectOverride: (input) =>
      validated(input, parseSetProjectOverride, (parsed) => exclusive(() => setOverride(parsed))),
    setProjectLibraryBinding: (input) =>
      validated(input, parseSetProjectLibraryBinding, (parsed) =>
        guardLibrary(() => exclusive(() => setBinding(parsed))),
      ),
    removeProjectLibraryBinding: (input) =>
      validated(input, parseRemoveProjectLibraryBinding, (parsed) =>
        guardLibrary(() => exclusive(() => removeBinding(parsed))),
      ),
    previewLibrarySync: (input) =>
      validated(input, parsePreviewLibrarySync, (selection) =>
        guardLibrary(async () => {
          const context = await loadSyncContext(selection);
          if (!context.ok) return context;
          return ok(
            await previewProfileSync({ ...context.value, root, scopes: LIBRARY_SYNC_SCOPES }),
          );
        }),
      ),
    applyLibrarySync: (input) =>
      validated(input, parseApplyLibrarySync, ({ approvedIds, ...selection }) =>
        guardLibrary(() =>
          exclusive(async () => {
            const context = await loadSyncContext(selection);
            if (!context.ok) return context;
            return ok(
              await applyProfileSync({
                ...context.value,
                root,
                scopes: LIBRARY_SYNC_SCOPES,
                approvedIds,
                approvals: 'key',
                runner: deps.runner,
                baseEnv: await deps.baseEnv(),
              }),
            );
          }),
        ),
      ),
  };
}
