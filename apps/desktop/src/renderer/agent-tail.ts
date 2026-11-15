import type { SupportedLocale } from '@inova/core/types';
import type { ChatItem } from './chat-reducer';
import { translate } from './i18n';

function itemText(item: ChatItem, locale: SupportedLocale): string {
  switch (item.type) {
    case 'assistant':
    case 'thinking':
    case 'user':
      return item.text;
    case 'error':
      return item.message;
    case 'tool':
      return `› ${item.name}\n${item.output ?? item.input}`;
    case 'checkpoint':
      return translate(locale, 'tool.checkpointSaved');
    case 'verification':
      return translate(locale, 'tool.verificationPrefix', { status: item.status });
  }
}

export function agentTail(input: {
  items: readonly ChatItem[];
  lines: number;
  locale?: SupportedLocale;
}): string {
  const last = input.items[input.items.length - 1];
  if (!last) return '';
  const lines = itemText(last, input.locale ?? 'pt-BR')
    .split('\n')
    .filter((line) => line.trim() !== '');
  return lines.slice(-input.lines).join('\n');
}
