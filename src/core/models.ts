import type { EffortLevel, ProviderId } from './types.js';

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface ProviderModels {
  defaultModelLabel: string;
  defaultEffortLabel: string;
  models: readonly ModelOption[];
  efforts: readonly EffortLevel[];
}

export const EFFORT_LEVELS: readonly EffortLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export const EFFORT_LABEL: Record<EffortLevel, string> = {
  minimal: 'Mínimo',
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Extra alto',
  max: 'Máximo',
};

const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && EFFORT_SET.has(value);
}

export const PROVIDER_MODELS: Record<ProviderId, ProviderModels> = {
  claude: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      { id: 'sonnet', label: 'Sonnet 5.5', description: 'Equilibrado para uso diário' },
      { id: 'opus', label: 'Opus 5.5', description: 'Raciocínio profundo e tarefas complexas' },
      { id: 'haiku', label: 'Haiku 5.5', description: 'Rápido e econômico' },
      { id: 'fable', label: 'Fable 5.2', description: 'Sessões longas e autônomas' },
      {
        id: 'opusplan',
        label: 'Opus 5.5 Plan',
        description: 'Opus 5.5 para plano, Sonnet 5.5 para execução',
      },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  codex: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      {
        id: 'gpt-6-astra',
        label: 'GPT 6 Astra',
        description: 'Inteligência de fronteira para tarefas exigentes',
      },
      {
        id: 'gpt-6.1-sol',
        label: 'GPT 6.1 Sol',
        description: 'Mais recente para código e uso diário',
      },
      {
        id: 'gpt-6-sol',
        label: 'GPT 6 Sol',
        description: 'Geração anterior para engenharia e código',
      },
      {
        id: 'gpt-6-luna',
        label: 'GPT 6 Luna',
        description: 'Rápido e econômico para tarefas simples',
      },
      {
        id: 'gpt-5.6-terra',
        label: 'GPT 5.6 Terra',
        description: 'Equilibrado para tarefas diretas',
      },
      { id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', description: 'Rápido e eficiente' },
    ],
    efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  },
  gemini: {
    defaultModelLabel: 'Auto',
    defaultEffortLabel: 'Padrão',
    models: [
      { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
      { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
      { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
      { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
      { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
      { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  deepseek: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3.2', description: 'Uso diário e código rápido' },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek R2',
        description: 'Raciocínio profundo e arquitetura',
      },
      { id: 'deepseek-v3', label: 'DeepSeek V3', description: 'Modelo estável anterior' },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  kimi: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5', description: 'Agente multimodal e código avançado' },
      { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', description: 'Raciocínio estendido' },
      { id: 'kimi-k2', label: 'Kimi K2', description: 'Equilibrado e rápido' },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  grok: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      { id: 'grok-4', label: 'Grok 4', description: 'Raciocínio e engenharia avançada' },
      {
        id: 'grok-code-fast-1',
        label: 'Grok Code 1 Fast',
        description: 'Especializado em código de baixa latência',
      },
      { id: 'grok-3-mini', label: 'Grok 3 Mini', description: 'Leve e econômico' },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  qwen: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      {
        id: 'qwen3-coder-plus',
        label: 'Qwen 3 Coder Plus',
        description: 'Contexto longo para repositórios',
      },
      { id: 'qwen3-coder-flash', label: 'Qwen 3 Coder Flash', description: 'Edições rápidas' },
      {
        id: 'qwen3-235b-a22b',
        label: 'Qwen 3 235B',
        description: 'Modelo MoE para tarefas complexas',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  opencode: {
    defaultModelLabel: 'Padrão',
    defaultEffortLabel: 'Padrão',
    models: [
      {
        id: 'opencode/zen-pro',
        label: 'OpenCode Zen Pro 1.0',
        description: 'Roteamento multi-provedor',
      },
      {
        id: 'anthropic/claude-sonnet-4-5',
        label: 'Claude Sonnet 4.5',
        description: 'Via OpenCode',
      },
      { id: 'openai/gpt-5', label: 'GPT 5', description: 'Via OpenCode' },
    ],
    efforts: ['low', 'medium', 'high'],
  },
};

export function isEffortSupported(provider: ProviderId, effort: EffortLevel): boolean {
  return PROVIDER_MODELS[provider].efforts.includes(effort);
}

// REGEX: strip ANSI CSI/OSC sequences emitted by CLI spinners
const ANSI_ESCAPE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]/g;
// REGEX: match `<model-id>  <Display Name>` rows emitted by `agy models`
const AGY_MODEL_ROW = /^([A-Za-z0-9][A-Za-z0-9._:/-]+)\s{2,}(.+)$/;

export function parseAgyModelsOutput(stdout: string): ModelOption[] {
  const cleaned = stdout.replace(ANSI_ESCAPE, '');
  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const chunk of cleaned.split(/[\r\n]+/)) {
    const line = chunk.trim();
    const match = AGY_MODEL_ROW.exec(line);
    if (!match) continue;
    const id = match[1];
    const label = match[2]?.trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label });
  }
  return models;
}

// REGEX: match `<provider>/<model-id>` lines emitted by `opencode models`
const OPENCODE_MODEL_ROW = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._:/-]+)$/;

export function parseOpenCodeModelsOutput(stdout: string): ModelOption[] {
  const cleaned = stdout.replace(ANSI_ESCAPE, '');
  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const chunk of cleaned.split(/[\r\n]+/)) {
    const line = chunk.trim();
    const match = OPENCODE_MODEL_ROW.exec(line);
    if (!match) continue;
    const provider = match[1];
    const modelId = match[2];
    if (!provider || !modelId || seen.has(line)) continue;
    seen.add(line);
    models.push({ id: line, label: modelId, description: provider });
  }
  return models;
}
