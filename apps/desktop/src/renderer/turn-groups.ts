import type { ChatItem } from './chat-reducer';

type ToolItem = Extract<ChatItem, { type: 'tool' }>;

export interface ChatEntry {
  item: ChatItem;
  index: number;
}

export type ChatBlock =
  | ({ kind: 'item' } & ChatEntry)
  | { kind: 'work'; id: string; index: number; entries: ChatEntry[] };

export type ToolKind = 'shell' | 'edit' | 'other';

const SHELL_TOOL = /bash|shell|exec/i;
const EDIT_TOOL = /edit|write/i;
const SUMMARY_KEYS = [
  'description',
  'command',
  'file_path',
  'filePath',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
] as const;
const MAX_SUMMARY_CHARS = 100;

export function toolKind(name: string): ToolKind {
  if (SHELL_TOOL.test(name)) return 'shell';
  if (EDIT_TOOL.test(name)) return 'edit';
  return 'other';
}

function firstLine(input: string): string {
  const line = input.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  const trimmed = line.trim();
  return trimmed.length > MAX_SUMMARY_CHARS ? `${trimmed.slice(0, MAX_SUMMARY_CHARS)}…` : trimmed;
}

function parseInputRecord(input: string): Record<string, unknown> | null {
  if (!input.trimStart().startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(input);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function plural(input: { count: number; one: string; many: string }): string {
  return `${input.count} ${input.count === 1 ? input.one : input.many}`;
}

export function toolSummary(item: Pick<ToolItem, 'input' | 'output' | 'isError'>): {
  title: string;
  result: string | null;
} {
  const record = parseInputRecord(item.input);
  const described = SUMMARY_KEYS.flatMap((key) => {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() !== '' ? [value] : [];
  })[0];
  const title = firstLine(described ?? item.input);
  if (item.output === null || item.isError) return { title, result: null };
  const output = item.output.trim();
  const result =
    output === ''
      ? 'sem saída'
      : plural({ count: output.split('\n').length, one: 'linha', many: 'linhas' });
  return { title, result };
}

export function summarizeWork(entries: readonly ChatEntry[]): string {
  const tools = entries.flatMap((entry) => (entry.item.type === 'tool' ? [entry.item] : []));
  const count = (kind: ToolKind) => tools.filter((tool) => toolKind(tool.name) === kind).length;
  const failed = tools.filter((tool) => tool.isError).length;
  const parts = [
    { count: count('shell'), one: 'comando', many: 'comandos' },
    { count: count('edit'), one: 'edição', many: 'edições' },
    { count: count('other'), one: 'outra ação', many: 'outras ações' },
  ]
    .filter((part) => part.count > 0)
    .map(plural);
  if (failed > 0) parts.push(`${failed} com erro`);
  return parts.join(' · ');
}

function groupTurn(entries: ChatEntry[], expanded: boolean): ChatBlock[] {
  const asItems = (): ChatBlock[] => entries.map((entry) => ({ kind: 'item', ...entry }));
  if (expanded) return asItems();
  const answer = entries.filter((entry) => entry.item.type === 'assistant').pop();
  if (!answer) return asItems();
  const work = entries.filter(
    (entry) =>
      entry.index < answer.index && (entry.item.type === 'tool' || entry.item.type === 'assistant'),
  );
  const first = work[0];
  if (!first || !work.some((entry) => entry.item.type === 'tool')) return asItems();
  const hidden = new Set(work.map((entry) => entry.index));
  return entries.flatMap((entry): ChatBlock[] => {
    if (entry.index === first.index) {
      return [{ kind: 'work', id: `work-${first.item.id}`, index: first.index, entries: work }];
    }
    return hidden.has(entry.index) ? [] : [{ kind: 'item', ...entry }];
  });
}

export function groupChatItems(
  items: readonly ChatItem[],
  running: boolean,
  collapseFinishedTurns = true,
): ChatBlock[] {
  const turns: ChatEntry[][] = [];
  items.forEach((item, index) => {
    const current = turns[turns.length - 1];
    if (item.type === 'user' || !current) turns.push([{ item, index }]);
    else current.push({ item, index });
  });
  return turns.flatMap((turn, turnIndex) =>
    groupTurn(turn, !collapseFinishedTurns || (running && turnIndex === turns.length - 1)),
  );
}
