import type { ContextSection, ContextSectionRow } from '@inova/core/chat-types';

const CATEGORY_LABELS: Record<string, string> = {
  'System prompt': 'Prompt de sistema',
  'System tools': 'Ferramentas do sistema',
  'System tools (deferred)': 'Ferramentas do sistema (sob demanda)',
  'MCP tools': 'Ferramentas MCP',
  'MCP tools (deferred)': 'Ferramentas MCP (sob demanda)',
  'Custom agents': 'Agentes',
  'Memory files': 'Arquivos de memória',
  Skills: 'Skills',
  Messages: 'Mensagens',
  'Free space': 'Espaço livre',
  'Autocompact buffer': 'Reserva de autocompactação',
};

const SECTION_LABELS: Record<string, string> = {
  'MCP Tools': 'Ferramentas MCP',
  'Custom Agents': 'Agentes',
  'Memory Files': 'Arquivos de memória',
  Skills: 'Skills',
};

const RESERVED_CATEGORIES: ReadonlySet<string> = new Set(['Free space', 'Autocompact buffer']);

export function categoryLabel(name: string): string {
  return CATEGORY_LABELS[name] ?? name;
}

export function sectionLabel(title: string): string {
  return SECTION_LABELS[title] ?? title;
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
