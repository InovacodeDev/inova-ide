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

  function fromUser(message: unknown): ChatEvent[] {
    if (!isRecord(message) || !Array.isArray(message['content'])) return [];
    const events: ChatEvent[] = [];
    for (const block of message['content']) {
      if (!isRecord(block) || block['type'] !== 'tool_result') continue;
      const toolId = str(block['tool_use_id']);
      if (toolId === null) continue;
      events.push({
        kind: 'tool-result',
        toolId,
        output: toolOutput(block['content']),
        isError: block['is_error'] === true,
      });
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
        case 'user':
          return fromUser(data['message']);
        case 'result': {
          const isError = data['is_error'] === true;
          const done: ChatEvent = {
            kind: 'done',
            isError,
            costUsd: num(data['total_cost_usd']),
            durationMs: num(data['duration_ms']),
          };
          return isError ? [{ kind: 'error', message: claudeErrorMessage(data) }, done] : [done];
        }
        default:
          return [];
      }
    },
  };
}

function claudeErrorMessage(data: Json): string {
  const errors = Array.isArray(data['errors'])
    ? data['errors'].filter((item): item is string => typeof item === 'string')
    : [];
  if (errors.length > 0) return errors.join('\n');
  return str(data['result']) ?? str(data['subtype']) ?? 'Claude failed';
}

function createGeminiParser(prefix: string): ChatParser {
  let block = 0;
  let open = false;
  let buffer = '';

  function flush(): ChatEvent[] {
    if (!open) return [];
    open = false;
    const text = buffer;
    buffer = '';
    return [{ kind: 'text', blockId: `${prefix}gemini-${block}`, text }];
  }

  function errorMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (isRecord(value)) return str(value['message']) ?? 'Gemini failed';
    return 'Gemini failed';
  }

  return {
    parse(line) {
      const data = decodeLine(line);
      if (data === null) return [];
      switch (data['type']) {
        case 'init': {
          const sessionId = str(data['session_id']);
          return sessionId === null ? [] : [{ kind: 'session', providerSessionId: sessionId }];
        }
        case 'message': {
          const text = str(data['content']);
          if (data['role'] !== 'assistant' || text === null) return [];
          if (data['delta'] === true) {
            if (!open) {
              block += 1;
              open = true;
            }
            buffer += text;
            return [{ kind: 'text-delta', blockId: `${prefix}gemini-${block}`, text }];
          }
          const closed = flush();
          block += 1;
          return [...closed, { kind: 'text', blockId: `${prefix}gemini-${block}`, text }];
        }
        case 'tool_use': {
          const toolId = str(data['tool_id']);
          const name = str(data['tool_name']);
          if (toolId === null || name === null) return [];
          const closed = flush();
          block += 1;
          return [
            ...closed,
            {
              kind: 'tool-use',
              toolId: `${prefix}${toolId}`,
              name,
              input: prettyJson(data['parameters']),
            },
          ];
        }
        case 'tool_result': {
          const toolId = str(data['tool_id']);
          if (toolId === null) return [];
          const failed = data['status'] === 'error' || isRecord(data['error']);
          const output = failed ? errorMessage(data['error']) : (str(data['output']) ?? '');
          return [
            ...flush(),
            { kind: 'tool-result', toolId: `${prefix}${toolId}`, output, isError: failed },
          ];
        }
        case 'error':
          return [...flush(), { kind: 'error', message: errorMessage(data) }];
        case 'result': {
          const stats = isRecord(data['stats']) ? data['stats'] : {};
          const failed = data['status'] !== 'success';
          const done: ChatEvent = {
            kind: 'done',
            isError: failed,
            costUsd: null,
            durationMs: num(stats['duration_ms']),
          };
          const tail: ChatEvent[] = failed
            ? [{ kind: 'error', message: errorMessage(data['error']) }, done]
            : [done];
          return [...flush(), ...tail];
        }
        default:
          return [];
      }
    },
  };
}

function createCodexParser(prefix: string): ChatParser {
  const failedDone: ChatEvent = { kind: 'done', isError: true, costUsd: null, durationMs: null };

  function fromItem(started: boolean, item: unknown): ChatEvent[] {
    if (!isRecord(item)) return [];
    const rawId = str(item['id']);
    if (rawId === null) return [];
    const id = `${prefix}${rawId}`;
    if (item['type'] === 'command_execution') {
      if (started) {
        return [
          {
            kind: 'tool-use',
            toolId: id,
            name: 'command_execution',
            input: str(item['command']) ?? '',
          },
        ];
      }
      const exitCode = num(item['exit_code']);
      const isError = item['status'] === 'failed' || (exitCode !== null && exitCode !== 0);
      return [
        { kind: 'tool-result', toolId: id, output: str(item['aggregated_output']) ?? '', isError },
      ];
    }
    const text = str(item['text']);
    if (!started && item['type'] === 'agent_message' && text !== null) {
      return [{ kind: 'text', blockId: id, text }];
    }
    return [];
  }

  return {
    parse(line) {
      const data = decodeLine(line);
      if (data === null) return [];
      switch (data['type']) {
        case 'thread.started': {
          const threadId = str(data['thread_id']);
          return threadId === null ? [] : [{ kind: 'session', providerSessionId: threadId }];
        }
        case 'item.started':
          return fromItem(true, data['item']);
        case 'item.completed':
          return fromItem(false, data['item']);
        case 'turn.completed':
          return [{ kind: 'done', isError: false, costUsd: null, durationMs: null }];
        case 'turn.failed': {
          const error = isRecord(data['error']) ? data['error'] : {};
          return [
            { kind: 'error', message: str(error['message']) ?? 'Codex turn failed' },
            failedDone,
          ];
        }
        case 'error':
          return [{ kind: 'error', message: str(data['message']) ?? 'Codex error' }];
        default:
          return [];
      }
    },
  };
}

export function createChatParser(provider: ProviderId, options: { turnId: string }): ChatParser {
  const prefix = `${options.turnId}:`;
  switch (provider) {
    case 'claude':
      return createClaudeParser();
    case 'gemini':
      return createGeminiParser(prefix);
    case 'codex':
      return createCodexParser(prefix);
  }
}
