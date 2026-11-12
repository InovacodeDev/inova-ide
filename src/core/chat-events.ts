import type { ChatEvent, UsageWindow } from './chat-types.js';
import type { ProviderId } from './types.js';

export interface ChatParser {
  parse(line: string): ChatEvent[];
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function decodeLine(line: string): Json | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string') {
      parts.push(part['text']);
    }
  }
  return parts.join('\n');
}

function epochToIso(seconds: unknown): string | null {
  const value = num(seconds);
  return value === null ? null : new Date(value * 1000).toISOString();
}

function claudeUsage(info: unknown): ChatEvent[] {
  if (!isRecord(info) || !isRecord(info['unifiedWindows'])) return [];
  const windows: UsageWindow[] = [];
  const kinds = [
    ['five_hour', 'session'],
    ['seven_day', 'weekly'],
  ] as const;
  for (const [key, kind] of kinds) {
    const entry = info['unifiedWindows'][key];
    if (!isRecord(entry)) continue;
    const utilization = num(entry['utilization']);
    if (utilization === null) continue;
    windows.push({ kind, usedPercent: utilization * 100, resetsAt: epochToIso(entry['resetsAt']) });
  }
  return windows.length > 0 ? [{ kind: 'usage-limits', windows }] : [];
}

function createClaudeParser(): ChatParser {
  let messageId = '';

  function fromStreamEvent(event: unknown): ChatEvent[] {
    if (!isRecord(event)) return [];
    if (event['type'] === 'message_start' && isRecord(event['message'])) {
      messageId = str(event['message']['id']) ?? messageId;
      return [];
    }
    if (event['type'] !== 'content_block_delta' || !isRecord(event['delta'])) return [];
    const text = str(event['delta']['text']);
    if (event['delta']['type'] !== 'text_delta' || text === null) return [];
    return [{ kind: 'text-delta', blockId: messageId, text }];
  }

  function fromAssistant(message: unknown): ChatEvent[] {
    if (!isRecord(message) || !Array.isArray(message['content'])) return [];
    messageId = str(message['id']) ?? messageId;
    const events: ChatEvent[] = [];
    for (const block of message['content']) {
      if (!isRecord(block)) continue;
      const text = str(block['text']);
      if (block['type'] === 'text' && text !== null) {
        events.push({ kind: 'text', blockId: messageId, text });
      } else if (block['type'] === 'tool_use') {
        const toolId = str(block['id']);
        const name = str(block['name']);
        if (toolId !== null && name !== null) {
          events.push({ kind: 'tool-use', toolId, name, input: prettyJson(block['input']) });
        }
      }
    }
    return events;
  }


  return {
    parse(line) {
      const data = decodeLine(line);
      if (data === null) return [];
      switch (data['type']) {
        case 'system': {
          const sessionId = str(data['session_id']);
          return data['subtype'] === 'init' && sessionId !== null
            ? [{ kind: 'session', providerSessionId: sessionId }]
            : [];
        }
        case 'rate_limit_event':
          return claudeUsage(data['rate_limit_info']);
        case 'stream_event':
          return fromStreamEvent(data['event']);
        case 'assistant':
          return fromAssistant(data['message']);
        case 'result':
          return [
            {
              kind: 'done',
              isError: data['is_error'] === true,
              costUsd: num(data['total_cost_usd']),
              durationMs: num(data['duration_ms']),
            },
          ];
        default:
          return [];
      }
    },
  };
}

export function createChatParser(provider: ProviderId): ChatParser {
  if (provider === 'claude') return createClaudeParser();\n  return { parse: () => [] };\n}
