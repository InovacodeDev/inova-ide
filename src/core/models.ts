import type { EffortLevel, ProviderId, Settings } from './types.js';

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface ProviderModels {
  defaultModelLabel: string;
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
    models: [
      { id: 'sonnet', label: 'Sonnet 5.5', description: 'Equilibrado para uso diário' },
      { id: 'opus', label: 'Opus 5.5', description: 'Raciocínio profundo e tarefas complexas' },
      {
        id: 'fable',
        label: 'Fable 5.2',
        description: 'Raciocínio exigente e sessões longas autônomas',
      },
      { id: 'haiku', label: 'Haiku 5.5', description: 'Rápido e econômico' },
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
    models: [
      {
        id: 'gpt-6.2-astra',
        label: 'GPT 6.2 Astra',
        description: 'Inteligência de fronteira para tarefas exigentes',
      },
      {
        id: 'gpt-6.2-sol',
        label: 'GPT 6.2 Sol',
        description: 'Mais recente para código e uso diário',
      },
      {
        id: 'gpt-6.1-sol',
        label: 'GPT 6.1 Sol',
        description: 'Equilibrado para código e fluxos agênticos',
      },
      {
        id: 'gpt-6-astra',
        label: 'GPT 6 Astra',
        description: 'Geração anterior de fronteira',
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
    models: [
      { id: 'gemini-4-neon-xhigh', label: 'Gemini 4 Neon (XHigh)' },
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)' },
      { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
      { id: 'gemini-4-neon-low', label: 'Gemini 4 Neon (Low)' },
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
      { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
      { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh)' },
      { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High)' },
      { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
      { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low)' },
      { id: 'gemini-pro-orchestrator-neon', label: 'Gemini 4 Orchestrator (Neon)' },
      { id: 'gemini-pro-orchestrator-g1-pro', label: 'Gemini 4 Orchestrator (Argon)' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' },
      { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
      { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
      { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)' },
      { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
      { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  deepseek: {
    defaultModelLabel: 'Padrão',
    models: [
      {
        id: 'deepseek-flash',
        label: 'DeepSeek V4.1 Flash',
        description: 'Multimodal rápido com contexto de 1M e raciocínio',
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'MoE principal para raciocínio profundo e arquitetura',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  kimi: {
    defaultModelLabel: 'Padrão',
    models: [
      {
        id: 'kimi-k3.1-pro',
        label: 'Kimi K3.1 Pro',
        description: 'Principal multimodal com contexto de 1M e raciocínio',
      },
      {
        id: 'kimi-k3.1-pro-highspeed',
        label: 'Kimi K3.1 Pro Highspeed',
        description: 'K3.1 Pro com geração 2 a 3× mais rápida',
      },
      {
        id: 'kimi-k3',
        label: 'Kimi K3',
        description: 'Modelo aberto multimodal com contexto de 1M',
      },
      {
        id: 'kimi-for-coding',
        label: 'Kimi K2.8 Code',
        description: 'Otimizado para tarefas agênticas de código',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  grok: {
    defaultModelLabel: 'Padrão',
    models: [
      {
        id: 'grok-4.7',
        label: 'Grok 4.7',
        description: 'Principal para código complexo e agentes longos',
      },
      {
        id: 'grok-4.6',
        label: 'Grok 4.6',
        description: 'Agentes interativos, código e tarefas visuais',
      },
      {
        id: 'grok-4.20-reasoning',
        label: 'Grok 4.20 Reasoning',
        description: 'Raciocínio profundo com contexto longo',
      },
      {
        id: 'grok-4.20-non-reasoning',
        label: 'Grok 4.20 Fast',
        description: 'Alta velocidade e baixa latência para tarefas diretas',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  qwen: {
    defaultModelLabel: 'Padrão',
    models: [
      {
        id: 'qwen4-max',
        label: 'Qwen 4 Max',
        description: 'Principal multimodal com contexto de 1M e raciocínio',
      },
      {
        id: 'qwen3.8-max',
        label: 'Qwen 3.8 Max',
        description: 'MoE de alta capacidade para engenharia complexa',
      },
      {
        id: 'qwen3.8-flash',
        label: 'Qwen 3.8 Flash',
        description: 'Rápido e econômico para edições e agentes',
      },
      {
        id: 'qwen3.6-plus',
        label: 'Qwen 3.6 Plus',
        description: 'Equilibrado com raciocínio aprimorado',
      },
      {
        id: 'qwen3-coder-plus',
        label: 'Qwen 3 Coder Plus',
        description: 'Contexto longo para repositórios',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
  opencode: {
    defaultModelLabel: 'Padrão',
    models: [
      {
        id: 'opencode/claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/claude-opus-5-5',
        label: 'Claude Opus 5.5',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/gpt-6.2-sol',
        label: 'GPT 6.2 Sol',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/gpt-6.2-astra',
        label: 'GPT 6.2 Astra',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/gemini-4-hydrogen',
        label: 'Gemini 4 Hydrogen',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/gemini-4-carbon',
        label: 'Gemini 4 Carbon',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash',
        description: 'Via OpenCode Zen',
      },
      {
        id: 'opencode/deepseek-v4.1-flash-free',
        label: 'DeepSeek V4.1 Flash Free',
        description: 'Gratuito via OpenCode Zen',
      },
    ],
    efforts: ['low', 'medium', 'high'],
  },
};

export function isEffortSupported(provider: ProviderId, effort: EffortLevel): boolean {
  return PROVIDER_MODELS[provider].efforts.includes(effort);
}

export function resolveModelConfig(input: {
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel | null;
  settings: Pick<Settings, 'models'>;
}): { model: string | null; effort: EffortLevel | null } {
  const { provider, model, effort, settings } = input;
  const defaults = settings.models[provider];
  const settingsEffort = isEffortSupported(provider, defaults.effort) ? defaults.effort : null;
  const sessionEffort = effort !== null && isEffortSupported(provider, effort) ? effort : null;
  return { model: model ?? defaults.model, effort: sessionEffort ?? settingsEffort };
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
