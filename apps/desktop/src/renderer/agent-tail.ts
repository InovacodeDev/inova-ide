import type { ChatItem } from './chat-reducer';

function itemText(item: ChatItem): string {
  switch (item.type) {
    case 'assistant':
    case 'user':
      return item.text;
    case 'error':
      return item.message;
    case 'tool':
      return `› ${item.name}\n${item.output ?? item.input}`;
  }
}

export function agentTail(input: { items: readonly ChatItem[]; lines: number }): string {
  const last = input.items[input.items.length - 1];
  if (!last) return '';
  const lines = itemText(last)
    .split('\n')
    .filter((line) => line.trim() !== '');
  return lines.slice(-input.lines).join('\n');
}
