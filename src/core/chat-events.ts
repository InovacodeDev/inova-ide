import type { ChatEvent, SubagentSnapshot, SubagentStatus, UsageWindow } from './chat-types.js';
import { contextWindowFor } from './context-window.js';
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
    ['monthly', 'monthly'],
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

interface TokenCounts {
  input: number;
  output: number;
}

function usageCounts(usage: unknown): TokenCounts | null {
  if (!isRecord(usage)) return null;
  const output = num(usage['output_tokens']);
  const input = num(usage['input_tokens']);
  if (output === null && input === null) return null;
  return {
    input:
      (input ?? 0) +
      (num(usage['cache_read_input_tokens']) ?? 0) +
      (num(usage['cache_creation_input_tokens']) ?? 0),
    output: output ?? 0,
  };
}

function isSubagentTool(name: string): boolean {
  return name === 'Task' || name === 'Agent';
}

function createSubagentTracker(): {
  start(input: { toolId: string; input: unknown }): ChatEvent[];
  observeMessage(input: { toolId: string; message: Json }): ChatEvent[];
  finish(input: {
    toolId: string;
    status: SubagentStatus;
    totalTokens: number | null;
    result: Json | null;
  }): ChatEvent[];
  has(toolId: string): boolean;
  isRunning(toolId: string): boolean;
} {
  const snapshots = new Map<string, SubagentSnapshot>();
  const outputByMessage = new Map<string, Map<string, number>>();

  function update(toolId: string, patch: Partial<SubagentSnapshot>): ChatEvent[] {
    const current = snapshots.get(toolId);
    if (current === undefined) return [];
    const next = { ...current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(current)) return [];
    snapshots.set(toolId, next);
    return [{ kind: 'subagent', ...next }];
  }

  return {
    has: (toolId) => snapshots.has(toolId),
    isRunning: (toolId) => snapshots.get(toolId)?.status === 'running',
    start({ toolId, input }) {
      const fields = isRecord(input) ? input : {};
      const snapshot: SubagentSnapshot = {
        toolId,
        description: str(fields['description']) ?? str(fields['subagent_type']) ?? 'Subagente',
        agentType: str(fields['subagent_type']),
        model: str(fields['model']),
        status: 'running',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      snapshots.set(toolId, snapshot);
      return [{ kind: 'subagent', ...snapshot }];
    },
    observeMessage({ toolId, message }) {
      const current = snapshots.get(toolId);
      if (current === undefined || current.status !== 'running') return [];
      const counts = usageCounts(message['usage']);
      if (counts === null) return [];
      const outputs = outputByMessage.get(toolId) ?? new Map<string, number>();
      outputs.set(str(message['id']) ?? `m${outputs.size}`, counts.output);
      outputByMessage.set(toolId, outputs);
      const outputTokens = [...outputs.values()].reduce((sum, value) => sum + value, 0);
      return update(toolId, {
        model: str(message['model']) ?? current.model,
        inputTokens: counts.input,
        outputTokens,
        totalTokens: counts.input + outputTokens,
      });
    },
    finish({ toolId, status, totalTokens, result }) {
      const current = snapshots.get(toolId);
      if (current === undefined) return [];
      const usage = result === null ? null : usageCounts(result['usage']);
      const outputTokens = usage?.output ?? current.outputTokens;
      const total = totalTokens ?? current.totalTokens;
      const agentType = result === null ? null : str(result['agentType']);
      const model = result === null ? null : str(result['resolvedModel']);
      return update(toolId, {
        status,
        agentType: agentType ?? current.agentType,
        model: model ?? current.model,
        outputTokens,
        inputTokens: Math.max(0, total - outputTokens),
        totalTokens: total,
      });
    },
  };
}

function taskStatus(status: unknown): SubagentStatus {
  return status === 'completed' ? 'done' : 'error';
}

function extractToolResults(message: unknown): ChatEvent[] {
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

function createClaudeParser(): ChatParser {
  let messageId = '';
  let lastContext = '';
  const subagents = createSubagentTracker();

  function contextEvents(message: Json): ChatEvent[] {
    const counts = usageCounts(message['usage']);
    if (counts === null) return [];
    const model = str(message['model']);
    const event: ChatEvent = {
      kind: 'context',
      usedTokens: counts.input + counts.output,
      windowTokens: contextWindowFor(model),
      model,
    };
    const key = JSON.stringify(event);
    if (key === lastContext) return [];
    lastContext = key;
    return [event];
  }

  function fromUser(data: Json): ChatEvent[] {
    const message = data['message'];
    const result = isRecord(data['tool_use_result']) ? data['tool_use_result'] : null;
    const events: ChatEvent[] = [];
    if (isRecord(message) && Array.isArray(message['content'])) {
      for (const block of message['content']) {
        if (!isRecord(block) || block['type'] !== 'tool_result') continue;
        const toolId = str(block['tool_use_id']);
        if (toolId === null || !subagents.has(toolId)) continue;
        if (result === null && !subagents.isRunning(toolId)) continue;
        if (result !== null && result['status'] === 'async_launched') continue;
        const failed =
          block['is_error'] === true || (result !== null && result['status'] === 'failed');
        events.push(
          ...subagents.finish({
            toolId,
            status: failed ? 'error' : 'done',
            totalTokens: result === null ? null : num(result['totalTokens']),
            result,
          }),
        );
      }
    }
    return [...events, ...extractToolResults(message)];
  }

  function fromSystem(data: Json): ChatEvent[] {
    const sessionId = str(data['session_id']);
    if (data['subtype'] === 'init' && sessionId !== null) {
      return [{ kind: 'session', providerSessionId: sessionId }];
    }
    const toolId = str(data['tool_use_id']);
    if (data['subtype'] !== 'task_notification' || toolId === null) return [];
    const usage = isRecord(data['usage']) ? data['usage'] : null;
    return subagents.finish({
      toolId,
      status: taskStatus(data['status']),
      totalTokens: usage === null ? null : num(usage['total_tokens']),
      result: null,
    });
  }

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
          if (isSubagentTool(name))
            events.push(...subagents.start({ toolId, input: block['input'] }));
        }
      }
    }
    return [...events, ...contextEvents(message)];
  }

  return {
    parse(line) {
      const data = decodeLine(line);
      if (data === null) return [];
      const parentToolId = str(data['parent_tool_use_id']);
      switch (data['type']) {
        case 'system':
          return fromSystem(data);
        case 'rate_limit_event':
          return claudeUsage(data['rate_limit_info']);
        case 'stream_event':
          return parentToolId === null ? fromStreamEvent(data['event']) : [];
        case 'assistant': {
          if (parentToolId === null) return fromAssistant(data['message']);
          const message = data['message'];
          return isRecord(message)
            ? subagents.observeMessage({ toolId: parentToolId, message })
            : [];
        }
        case 'user':
          return parentToolId === null ? fromUser(data) : [];
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
  let sawText = false;
  let emittedError = false;
  let fallbackToolId = 0;
  const startedTools = new Set<string>();

  function flush(): ChatEvent[] {
    if (!open) return [];
    open = false;
    const text = buffer;
    buffer = '';
    if (text !== '') sawText = true;
    return [{ kind: 'text', blockId: `${prefix}gemini-${block}`, text }];
  }

  function errorMessage(value: unknown): string {
    if (typeof value === 'string' && value !== '') return value;
    if (isRecord(value)) {
      return (
        str(value['short_error']) ?? str(value['message']) ?? str(value['error']) ?? 'Gemini failed'
      );
    }
    return 'Gemini failed';
  }

  function appendDelta(text: string): ChatEvent[] {
    if (text === '') return [];
    if (!open) {
      block += 1;
      open = true;
    }
    buffer += text;
    sawText = true;
    return [{ kind: 'text-delta', blockId: `${prefix}gemini-${block}`, text }];
  }

  function parseToolStep(step: Json): ChatEvent[] {
    const info = isRecord(step['tool_info']) ? step['tool_info'] : null;
    const name = str(step['tool_name']) ?? str(info?.['name']);
    if (name === null) return [];
    const stepIndex = num(step['step_index']);
    const rawId = stepIndex !== null ? `step-${stepIndex}` : `tool-${++fallbackToolId}`;
    const toolId = `${prefix}${rawId}`;
    const events: ChatEvent[] = [...flush()];
    if (!startedTools.has(rawId)) {
      startedTools.add(rawId);
      events.push({ kind: 'tool-use', toolId, name, input: prettyJson(info?.['parameters']) });
    }
    if (step['state'] !== 'DONE') return events;
    const rawError = info?.['error'] ?? step['error'];
    const failed =
      rawError !== undefined || step['status'] === 'ERROR' || info?.['is_error'] === true;
    const output = failed ? errorMessage(rawError) : (str(info?.['output']) ?? '');
    events.push({ kind: 'tool-result', toolId, output, isError: failed });
    return events;
  }

  function parseStepUpdate(step: Json): ChatEvent[] {
    switch (step['step_type']) {
      case 'agent_response': {
        const delta = str(step['text_delta']);
        const events = delta === null ? [] : appendDelta(delta);
        if (step['state'] === 'DONE') return [...events, ...flush()];
        return events;
      }
      case 'tool':
        return parseToolStep(step);
      case 'error_message': {
        const rawError = step['error'] ?? step['message'] ?? step['text'];
        if (rawError === undefined) return [];
        emittedError = true;
        return [...flush(), { kind: 'error', message: errorMessage(rawError) }];
      }
      default:
        return [];
    }
  }

  function parseAgyErrorLine(trimmed: string): ChatEvent[] {
    const raw = trimmed.slice('AGY_ERROR:'.length).trim();
    const parsed = decodeLine(raw);
    const message = parsed !== null ? errorMessage(parsed) : raw !== '' ? raw : 'Gemini failed';
    emittedError = true;
    return [...flush(), { kind: 'error', message }];
  }

  return {
    parse(line) {
      const trimmed = line.trim();
      if (trimmed === '') return [];
      if (trimmed.startsWith('AGY_ERROR:')) return parseAgyErrorLine(trimmed);
      const data = decodeLine(trimmed);
      if (data === null) return [];
      switch (data['event']) {
        case 'init': {
          const sessionId = str(data['conversation_id']);
          return sessionId === null ? [] : [{ kind: 'session', providerSessionId: sessionId }];
        }
        case 'step_update':
          return isRecord(data['step_update']) ? parseStepUpdate(data['step_update']) : [];
        case 'result': {
          const res = isRecord(data['result']) ? data['result'] : null;
          if (res === null) return flush();
          const events: ChatEvent[] = [...flush()];
          const failed = res['status'] !== 'SUCCESS';
          const fallbackText = str(res['response']);
          if (!sawText && !failed && fallbackText !== null && fallbackText !== '') {
            block += 1;
            sawText = true;
            events.push({ kind: 'text', blockId: `${prefix}gemini-${block}`, text: fallbackText });
          }
          const durationSec = num(res['duration_seconds']);
          const durationMs = durationSec === null ? null : Math.round(durationSec * 1000);
          const done: ChatEvent = { kind: 'done', isError: failed, costUsd: null, durationMs };
          if (failed && !emittedError) {
            emittedError = true;
            events.push({ kind: 'error', message: errorMessage(res['error'] ?? res['message']) });
          }
          events.push(done);
          return events;
        }
        default:
          return [];
      }
    },
  };
}

function codexContext(usage: unknown): ChatEvent[] {
  if (!isRecord(usage)) return [];
  const input = num(usage['input_tokens']);
  if (input === null) return [];
  const usedTokens = input + (num(usage['output_tokens']) ?? 0);
  return [{ kind: 'context', usedTokens, windowTokens: null, model: null }];
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
          return [
            ...codexContext(data['usage']),
            { kind: 'done', isError: false, costUsd: null, durationMs: null },
          ];
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

function createStreamAgentParser(
  prefix: string,
  options: { fallbackLabel: string; initialBlockPrefix: string },
): ChatParser {
  let messageId = '';
  let fallbackCounter = 0;
  let emittedDone = false;
  let sawOpenCodeSession = false;
  const codexParser = createCodexParser(prefix);

  function nextBlockId(rawId: string | null): string {
    if (rawId !== null && rawId !== '') return rawId;
    fallbackCounter += 1;
    return `${prefix}${options.initialBlockPrefix}-${fallbackCounter}`;
  }

  function extractOpenCodeEvents(data: Json): ChatEvent[] | null {
    const type = str(data['type']);
    if (type === null || !isRecord(data['part'])) return null;
    const part = data['part'];
    const events: ChatEvent[] = [];
    const sessionId = str(data['sessionID']) ?? str(data['session_id']);
    if (!sawOpenCodeSession && sessionId !== null) {
      sawOpenCodeSession = true;
      events.push({ kind: 'session', providerSessionId: sessionId });
    }
    if (type === 'text') {
      const text = str(part['text']);
      if (text !== null && text !== '') {
        events.push({ kind: 'text', blockId: nextBlockId(str(part['id'])), text });
      }
      return events;
    }
    if (type === 'tool_use') {
      const toolId = str(part['callID']) ?? nextBlockId(str(part['id']));
      const name = str(part['tool']) ?? 'tool';
      const state = isRecord(part['state']) ? part['state'] : null;
      events.push({ kind: 'tool-use', toolId, name, input: prettyJson(state?.['input']) });
      if (state && (state['status'] === 'completed' || state['status'] === 'error')) {
        const isError = state['status'] === 'error';
        events.push({
          kind: 'tool-result',
          toolId,
          output: isError ? (str(state['error']) ?? 'Erro') : (str(state['output']) ?? ''),
          isError,
        });
      }
      return events;
    }
    if (type === 'step_finish') {
      const reason = str(part['reason']);
      if (reason === 'stop' || reason === null) {
        emittedDone = true;
        events.push({ kind: 'done', isError: false, costUsd: num(part['cost']), durationMs: null });
      }
      return events;
    }
    return events;
  }

  function fromMessage(message: Json): ChatEvent[] {
    const events: ChatEvent[] = [];
    messageId = str(message['id']) ?? messageId;
    const content = message['content'];
    if (typeof content === 'string' && content !== '') {
      events.push({ kind: 'text', blockId: nextBlockId(messageId), text: content });
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        const text = str(block['text']);
        if (block['type'] === 'text' && text !== null && text !== '') {
          events.push({ kind: 'text', blockId: nextBlockId(messageId), text });
        } else if (block['type'] === 'tool_use') {
          const toolId = str(block['id']) ?? nextBlockId(null);
          const name = str(block['name']);
          if (name !== null) {
            events.push({ kind: 'tool-use', toolId, name, input: prettyJson(block['input']) });
          }
        }
      }
    }
    if (Array.isArray(message['tool_calls'])) {
      for (const call of message['tool_calls']) {
        if (!isRecord(call)) continue;
        const fn = isRecord(call['function']) ? call['function'] : null;
        const name = str(fn?.['name']) ?? str(call['name']);
        if (name === null) continue;
        const toolId = str(call['id']) ?? nextBlockId(null);
        const argsRaw = fn?.['arguments'] ?? call['arguments'];
        const input = typeof argsRaw === 'string' ? argsRaw : prettyJson(argsRaw);
        events.push({ kind: 'tool-use', toolId, name, input });
      }
    }
    return events;
  }

  function fromToolRole(data: Json): ChatEvent[] {
    const toolId = str(data['tool_call_id']) ?? str(data['tool_use_id']);
    if (toolId === null) return [];
    return [
      {
        kind: 'tool-result',
        toolId,
        output: toolOutput(data['content'] ?? data['output']),
        isError: data['is_error'] === true,
      },
    ];
  }

  return {
    parse(line) {
      const data = decodeLine(line);
      if (data === null) return [];
      if (isRecord(data['part'])) return extractOpenCodeEvents(data) ?? [];
      if (data['role'] === 'assistant') return fromMessage(data);
      if (data['role'] === 'tool') return fromToolRole(data);

      const sessionId =
        str(data['session_id']) ?? str(data['conversation_id']) ?? str(data['thread_id']);
      switch (data['type']) {
        case 'system':
          return sessionId !== null ? [{ kind: 'session', providerSessionId: sessionId }] : [];
        case 'thread.started':
          return sessionId !== null ? [{ kind: 'session', providerSessionId: sessionId }] : [];
        case 'stream_event': {
          const event = data['event'];
          if (!isRecord(event)) return [];
          if (event['type'] === 'message_start' && isRecord(event['message'])) {
            messageId = str(event['message']['id']) ?? messageId;
            return [];
          }
          if (event['type'] !== 'content_block_delta' || !isRecord(event['delta'])) return [];
          const text = str(event['delta']['text']);
          if (event['delta']['type'] !== 'text_delta' || text === null) return [];
          return [{ kind: 'text-delta', blockId: nextBlockId(messageId), text }];
        }
        case 'assistant':
          return isRecord(data['message']) ? fromMessage(data['message']) : fromMessage(data);
        case 'user':
          return extractToolResults(isRecord(data['message']) ? data['message'] : data);
        case 'item.started':
        case 'item.completed':
          return codexParser.parse(line);
        case 'result': {
          if (emittedDone) return [];
          emittedDone = true;
          const isError = data['is_error'] === true;
          const done: ChatEvent = {
            kind: 'done',
            isError,
            costUsd: num(data['total_cost_usd']),
            durationMs: num(data['duration_ms']),
          };
          const errMsg =
            str(data['result']) ?? str(data['error']) ?? `${options.fallbackLabel} failed`;
          return isError ? [{ kind: 'error', message: errMsg }, done] : [done];
        }
        case 'error': {
          const err = isRecord(data['error']) ? data['error'] : null;
          const message =
            str(err?.['message']) ?? str(data['message']) ?? `${options.fallbackLabel} failed`;
          return [{ kind: 'error', message }];
        }
        default: {
          if (sessionId !== null && data['event'] === 'init') {
            return [{ kind: 'session', providerSessionId: sessionId }];
          }
          return [];
        }
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
    case 'deepseek':
      return createStreamAgentParser(prefix, {
        fallbackLabel: 'DeepSeek',
        initialBlockPrefix: 'deepseek',
      });
    case 'kimi':
      return createStreamAgentParser(prefix, { fallbackLabel: 'Kimi', initialBlockPrefix: 'kimi' });
    case 'grok':
      return createStreamAgentParser(prefix, { fallbackLabel: 'Grok', initialBlockPrefix: 'grok' });
    case 'qwen':
      return createStreamAgentParser(prefix, { fallbackLabel: 'Qwen', initialBlockPrefix: 'qwen' });
    case 'opencode':
      return createStreamAgentParser(prefix, {
        fallbackLabel: 'OpenCode',
        initialBlockPrefix: 'opencode',
      });
  }
}
