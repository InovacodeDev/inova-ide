import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { expandCommandPrompt } from '../command-prompt.js';
import {
  fallbackCommandDescription,
  parseMarkdownCommand,
  parseTomlStrings,
  type ProjectCommand,
} from '../commands.js';
import type { Project } from '../types.js';
import { parseSkillFrontMatter, SKILL_FILE, SKILL_MARKER_FILE } from './skills.js';
import { pluginDir, skillDir } from './store.js';
import { isPluginPackage, type Library } from './types.js';

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  return targetReal === rootReal || targetReal.startsWith(rootReal + sep);
}

async function readSafeFile(rootReal: string, filePath: string): Promise<string | null> {
  const fileReal = await realpath(filePath).catch(() => null);
  if (fileReal === null || !isInsideRoot(rootReal, fileReal)) return null;
  return readFile(fileReal, 'utf8').catch(() => null);
}

async function hasAuxiliaryEntries(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.some(
    (entry) =>
      entry.name !== SKILL_FILE && entry.name !== SKILL_MARKER_FILE && !entry.name.startsWith('.'),
  );
}

export async function resolveProjectLibraryCommands(input: {
  root: string;
  library: Library;
  project: Pick<Project, 'libraryBindings' | 'libraryOverrides'>;
}): Promise<ProjectCommand[]> {
  const bindings = input.project.libraryBindings ?? [];
  if (bindings.length === 0) return [];
  const overridden = new Set(input.project.libraryOverrides?.disabled ?? []);
  const byId = new Map(input.library.items.map((item) => [item.id, item]));
  const resolved: ProjectCommand[] = [];

  for (const binding of bindings) {
    if (!binding.enabled || overridden.has(binding.itemId)) continue;
    const item = byId.get(binding.itemId);
    if (!item || !item.enabled) continue;

    if (item.kind === 'skill') {
      const dir = skillDir(input.root, item.id);
      const rootReal = await realpath(dir).catch(() => null);
      if (rootReal === null) continue;
      const raw = await readSafeFile(rootReal, join(rootReal, SKILL_FILE));
      if (raw === null) continue;
      const parsed = parseSkillFrontMatter(raw);
      if (parsed.body === '') continue;
      const hasResources = await hasAuxiliaryEntries(rootReal);
      resolved.push({
        name: item.id,
        description:
          parsed.description ?? item.description ?? fallbackCommandDescription(parsed.body),
        source: 'library',
        kind: 'skill',
        body: parsed.body,
        libraryItemId: item.id,
        ...(hasResources ? { resourceDir: rootReal } : {}),
      });
      continue;
    }

    if (item.kind === 'plugin' && isPluginPackage(item.definition)) {
      const dir = pluginDir(input.root, item.id);
      const rootReal = await realpath(dir).catch(() => null);
      if (rootReal === null) continue;
      const disabledSkills = new Set(binding.disabledSkills ?? []);

      for (const skill of item.definition.skills) {
        if (disabledSkills.has(skill.id)) continue;
        const skillFolder = join(rootReal, ...skill.path.split('/'));
        const raw = await readSafeFile(rootReal, join(skillFolder, SKILL_FILE));
        if (raw === null) continue;
        const parsed = parseSkillFrontMatter(raw);
        if (parsed.body === '') continue;
        const hasResources = await hasAuxiliaryEntries(skillFolder);
        resolved.push({
          name: skill.id,
          description:
            skill.description ?? parsed.description ?? fallbackCommandDescription(parsed.body),
          source: 'plugin',
          kind: 'skill',
          body: parsed.body,
          libraryItemId: item.id,
          pluginId: item.id,
          pluginName: item.name,
          ...(hasResources ? { resourceDir: skillFolder } : {}),
        });
      }

      for (const command of item.definition.commands) {
        const commandFile = join(rootReal, ...command.path.split('/'));
        const raw = await readSafeFile(rootReal, commandFile);
        if (raw === null) continue;
        if (command.path.endsWith('.toml')) {
          const parsed = parseTomlStrings(raw);
          const body = parsed['prompt']?.trim() ?? '';
          if (body === '') continue;
          resolved.push({
            name: command.name,
            description:
              command.description ??
              parsed['description']?.trim() ??
              fallbackCommandDescription(body),
            source: 'plugin',
            kind: 'command',
            body,
            libraryItemId: item.id,
            pluginId: item.id,
            pluginName: item.name,
          });
          continue;
        }
        const parsed = parseMarkdownCommand(raw);
        if (parsed.body === '') continue;
        resolved.push({
          name: command.name,
          description: command.description ?? parsed.description,
          source: 'plugin',
          kind: 'command',
          body: parsed.body,
          libraryItemId: item.id,
          pluginId: item.id,
          pluginName: item.name,
        });
      }
    }
  }

  return resolved;
}

export function mergeProjectAndLibraryCommands(input: {
  local: readonly ProjectCommand[];
  library: readonly ProjectCommand[];
}): ProjectCommand[] {
  const takenNames = new Set(input.local.map((command) => command.name));
  const merged: ProjectCommand[] = [...input.local];

  for (const command of input.library) {
    if (!takenNames.has(command.name)) {
      takenNames.add(command.name);
      merged.push(command);
      continue;
    }
    if (command.pluginId) {
      const namespaced = `${command.pluginId}:${command.name}`;
      if (!takenNames.has(namespaced)) {
        takenNames.add(namespaced);
        merged.push({ ...command, name: namespaced });
      }
    }
  }

  return merged.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.source.localeCompare(b.source);
  });
}

export function findSlashCommand(
  commands: readonly ProjectCommand[],
  slashName: string,
): ProjectCommand | undefined {
  const direct = commands.find((item) => item.name === slashName);
  if (direct) return direct;
  const separator = slashName.indexOf(':');
  if (separator <= 0) return undefined;
  const pluginId = slashName.slice(0, separator);
  const shortName = slashName.slice(separator + 1);
  return commands.find((item) => item.pluginId === pluginId && item.name === shortName);
}

export function formatSkillExecutionPrompt(input: {
  command: ProjectCommand;
  args: string;
}): string {
  const expanded = expandCommandPrompt(input.command.body, input.args);
  if (!input.command.resourceDir) return expanded;
  return `[Skill /${input.command.name} — recursos auxiliares em: ${input.command.resourceDir}]\n\n${expanded}`;
}
