import type { ChatItem } from './chat-reducer';
import { translate, type SupportedLocale } from './i18n';
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

function clipActivityTarget(target: string, locale: SupportedLocale = 'pt-BR'): string {
  const trimmed = target.trim();
  if (trimmed === '') return translate(locale, 'turn.defaultTarget');
  return trimmed.length > MAX_ACTIVITY_TARGET_CHARS
    ? `${trimmed.slice(0, MAX_ACTIVITY_TARGET_CHARS - 1)}…`
    : trimmed;
}

export function summarizeWork(
  entries: readonly ChatEntry[],
  locale: SupportedLocale = 'pt-BR',
): string {
  const hasThinking = entries.some((entry) => entry.item.type === 'thinking');
  const tools = entries.flatMap((entry) => (entry.item.type === 'tool' ? [entry.item] : []));
  const count = (kind: ToolKind) => tools.filter((tool) => toolKind(tool.name) === kind).length;
  const failed = tools.filter((tool) => tool.isError).length;

  let addedTotal = 0;
  let removedTotal = 0;
  for (const tool of tools) {
    const presented = presentTool(tool, locale);
    if (presented.kind === 'edit') {
      addedTotal += presented.addedLines;
      removedTotal += presented.removedLines;
    }
  }

  const editCount = count('edit');
  const editLabel = plural({
    count: editCount,
    one: translate(locale, 'turn.editOne'),
    many: translate(locale, 'turn.editMany'),
  });
  const editSummary =
    editCount === 0
      ? null
      : addedTotal > 0 || removedTotal > 0
        ? `${editLabel} (+${addedTotal} -${removedTotal})`
        : editLabel;

  const parts: string[] = [];
  if (hasThinking) parts.push(translate(locale, 'turn.thinking'));
  const shellCount = count('shell');
  if (shellCount > 0) {
    parts.push(
      plural({
        count: shellCount,
        one: translate(locale, 'turn.cmdOne'),
        many: translate(locale, 'turn.cmdMany'),
      }),
    );
  }
  if (editSummary !== null) parts.push(editSummary);
  const otherCount = count('other');
  if (otherCount > 0) {
    parts.push(
      plural({
        count: otherCount,
        one: translate(locale, 'turn.otherOne'),
        many: translate(locale, 'turn.otherMany'),
      }),
    );
  }
  if (failed > 0) parts.push(translate(locale, 'turn.failedCount', { count: failed }));
  return parts.join(' · ');
}

export function activeTurnActivity(
  items: readonly ChatItem[],
  locale: SupportedLocale = 'pt-BR',
): string {
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
    const presented = presentTool(item, locale);
    switch (presented.kind) {
      case 'edit':
        return translate(locale, 'turn.activeEditing', { file: baseName(presented.filePath) });
      case 'shell':
        return translate(locale, 'turn.activeShell');
      case 'lookup':
        return translate(locale, 'turn.activeLookup', {
          target: clipActivityTarget(presented.target, locale),
        });
      case 'todo':
        return translate(locale, 'turn.activeTodo');
      case 'generic':
        return translate(locale, 'turn.activeGeneric', { name: item.name });
    }
  }
  const last = turnItems[turnItems.length - 1];
  if (last?.type === 'thinking' && last.streaming) return translate(locale, 'turn.activeThinking');
  return translate(locale, 'turn.activePending');
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
