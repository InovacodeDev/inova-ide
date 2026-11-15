import type { ContextSection, ContextSectionRow } from '@inova/core/chat-types';
import type { SupportedLocale } from '@inova/core/types';
import type { TranslationKey } from './i18n';
import { translate } from './i18n';

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  'System prompt': 'details.category.systemPrompt',
  'System tools': 'details.category.systemTools',
  'System tools (deferred)': 'details.category.systemToolsDeferred',
  'MCP tools': 'details.category.mcpTools',
  'MCP tools (deferred)': 'details.category.mcpToolsDeferred',
  'Custom agents': 'details.category.customAgents',
  'Memory files': 'details.category.memoryFiles',
  Skills: 'details.category.skills',
  Messages: 'details.category.messages',
  'Free space': 'details.category.freeSpace',
  'Autocompact buffer': 'details.category.autocompactBuffer',
};

const SECTION_KEYS: Record<string, TranslationKey> = {
  'MCP Tools': 'details.section.mcpTools',
  'Custom Agents': 'details.section.customAgents',
  'Memory Files': 'details.section.memoryFiles',
  Skills: 'details.section.skills',
};

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set(['Free space', 'Autocompact buffer']);

export function categoryLabel(name: string, locale: SupportedLocale = 'pt-BR'): string {
  const key = CATEGORY_KEYS[name];
  return key ? translate(locale, key) : name;
}

export function sectionLabel(title: string, locale: SupportedLocale = 'pt-BR'): string {
  const key = SECTION_KEYS[title];
  return key ? translate(locale, key) : title;
}

export function isReservedCategory(name: string): boolean {
  return RESERVED_CATEGORIES.has(name);
}

export function sortedRows(section: ContextSection): ContextSectionRow[] {
  return [...section.rows].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1));
}

export function sectionTotal(section: ContextSection): number {
  return section.rows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
}

export function rowParts(row: ContextSectionRow): { name: string; detail: string } {
  const [name = '', ...rest] = row.cells;
  return { name, detail: rest.slice(0, -1).join(' · ') };
}
