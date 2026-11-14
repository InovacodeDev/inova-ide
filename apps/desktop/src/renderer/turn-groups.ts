import type { ChatItem } from './chat-reducer';
import { plural, presentTool, toolSummary } from './tool-presentation';

export { toolSummary };

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
const MAX_ACTIVITY_TARGET_CHARS = 48;

export function toolKind(name: string): ToolKind {
  if (SHELL_TOOL.test(name)) return 'shell';
  if (EDIT_TOOL.test(name)) return 'edit';
  return 'other';
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function clipActivityTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed === '') return 'arquivos';
  return trimmed.length > MAX_ACTIVITY_TARGET_CHARS
    ? `${trimmed.slice(0, MAX_ACTIVITY_TARGET_CHARS - 1)}…`
    : trimmed;
}

export function summarizeWork(entries: readonly ChatEntry[]): string {
  const hasThinking = entries.some((entry) => entry.item.type === 'thinking');
  const tools = entries.flatMap((entry) => (entry.item.type === 'tool' ? [entry.item] : []));
  const count = (kind: ToolKind) => tools.filter((tool) => toolKind(tool.name) === kind).length;
  const failed = tools.filter((tool) => tool.isError).length;

  let addedTotal = 0;
  let removedTotal = 0;
  for (const tool of tools) {
    const presented = presentTool(tool);
    if (presented.kind === 'edit') {
      addedTotal += presented.addedLines;
      removedTotal += presented.removedLines;
    }
  }

  const editCount = count('edit');
  const editSummary =
    editCount === 0
      ? null
      : addedTotal > 0 || removedTotal > 0
        ? `${plural({ count: editCount, one: 'edição', many: 'edições' })} (+${addedTotal} -${removedTotal})`
        : plural({ count: editCount, one: 'edição', many: 'edições' });

  const parts: string[] = [];
  if (hasThinking) parts.push('raciocínio');
  const shellCount = count('shell');
  if (shellCount > 0) parts.push(plural({ count: shellCount, one: 'comando', many: 'comandos' }));
  if (editSummary !== null) parts.push(editSummary);
  const otherCount = count('other');
  if (otherCount > 0) {
    parts.push(plural({ count: otherCount, one: 'outra ação', many: 'outras ações' }));
  }
  if (failed > 0) parts.push(`${failed} com erro`);
  return parts.join(' · ');
}

export function activeTurnActivity(items: readonly ChatItem[]): string {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i]?.type === 'user') {
      start = i + 1;
      break;
    }
  }
  const turnItems = items.slice(start);
  for (let i = turnItems.length - 1; i >= 0; i -= 1) {
    const item = turnItems[i];
    if (item?.type !== 'tool' || item.output !== null) continue;
    const presented = presentTool(item);
    switch (presented.kind) {
      case 'edit':
        return `Editando ${baseName(presented.filePath)}…`;
      case 'shell':
        return 'Executando comando…';
      case 'lookup':
        return `Consultando ${clipActivityTarget(presented.target)}…`;
      case 'todo':
        return 'Atualizando tarefas…';
      case 'generic':
        return `Executando ${item.name}…`;
    }
  }
  const last = turnItems[turnItems.length - 1];
  if (last?.type === 'thinking' && last.streaming) return 'Raciocinando…';
  return 'Pensando…';
}

function groupTurn(entries: ChatEntry[], expanded: boolean): ChatBlock[] {
  const asItems = (): ChatBlock[] => entries.map((entry) => ({ kind: 'item', ...entry }));
  if (expanded) return asItems();
  const answer = entries.filter((entry) => entry.item.type === 'assistant').pop();
  if (!answer) return asItems();
  const work = entries.filter(
    (entry) =>
      entry.index < answer.index &&
      (entry.item.type === 'tool' ||
        entry.item.type === 'assistant' ||
        entry.item.type === 'thinking'),
  );
  const first = work[0];
  if (
    !first ||
    !work.some((entry) => entry.item.type === 'tool' || entry.item.type === 'thinking')
  ) {
    return asItems();
  }
  const hidden = new Set(work.map((entry) => entry.index));
  return entries.flatMap((entry): ChatBlock[] => {
    if (entry.index === first.index) {
      return [{ kind: 'work', id: `work-${first.item.id}`, index: first.index, entries: work }];
    }
    return hidden.has(entry.index) ? [] : [{ kind: 'item', ...entry }];
  });
}

export interface AgentTurnFooter {
  turnIndex: number;
  text: string;
  at: string | null;
  isLastTurn: boolean;
}

export function agentTurnFooters(input: {
  items: readonly ChatItem[];
  running: boolean;
}): Map<number, AgentTurnFooter> {
  const { items, running } = input;
  const turnStarts = items.flatMap((item, index) => (item.type === 'user' ? [index] : []));
  const footers = new Map<number, AgentTurnFooter>();
  turnStarts.forEach((start, turnIndex) => {
    const isLastTurn = turnIndex === turnStarts.length - 1;
    if (isLastTurn && running) return;
    const end = isLastTurn ? items.length : (turnStarts[turnIndex + 1] ?? items.length);
    const user = items[start];
    const answers = items
      .slice(start + 1, end)
      .flatMap((item, offset) =>
        item.type === 'assistant' ? [{ item, index: start + 1 + offset }] : [],
      );
    const final = answers[answers.length - 1];
    if (!final || final.item.streaming) return;
    footers.set(final.index, {
      turnIndex,
      text: answers.map((answer) => answer.item.text).join('\n\n'),
      at: user?.type === 'user' ? user.at : null,
      isLastTurn,
    });
  });
  return footers;
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
