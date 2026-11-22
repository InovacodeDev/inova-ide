import type { EffortLevel, ProviderId, Settings } from './types.js';

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  efforts?: readonly EffortLevel[];
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
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', efforts: ['low', 'medium', 'high', 'xhigh'] },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'] },
      {
        id: 'gemini-4-hydrogen',
        label: 'Gemini 4 Hydrogen',
        efforts: ['low', 'medium', 'high', 'xhigh'],
      },
      { id: 'gemini-pro-orchestrator-neon', label: 'Orchestrator (Neon)', efforts: [] },
      { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)', efforts: [] },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'] },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', efforts: [] },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh'],
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
    efforts: [],
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
    efforts: [],
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
    efforts: [],
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
    efforts: [],
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
    efforts: [],
  },
};

// REGEX: match a concrete effort suffix in a legacy/variant model ID such as `gemini-4-hydrogen-high`
const MODEL_EFFORT_SUFFIX = /^(.+)-(minimal|low|medium|high|xhigh|max)$/i;
// REGEX: match a display label suffix such as `Gemini 4 Hydrogen (High)`
const LABEL_EFFORT_SUFFIX = /^(.+?)\s+\((minimal|low|medium|high|xhigh|max)\)$/i;
// REGEX: match legacy Claude model IDs without thinking effort support
const CLAUDE_NO_EFFORT_MODEL = /^claude-(3-|haiku-4-5|sonnet-4-(0|5)|opus-4-(0|1))/i;

export function splitModelEffortVariant(
  catalog: ProviderModels,
  model: string | null,
): { readonly model: string | null; readonly effort: EffortLevel | null } {
  if (model === null || catalog.models.some((item) => item.id === model)) {
    return { model, effort: null };
  }
  const match = MODEL_EFFORT_SUFFIX.exec(model);
  if (!match) return { model, effort: null };
  const baseId = match[1];
  const rawEffort = match[2]?.toLowerCase();
  if (!baseId || !isEffortLevel(rawEffort)) return { model, effort: null };
  const base = catalog.models.find((item) => item.id === baseId);
  if (!base) return { model, effort: null };
  const baseEfforts = base.efforts ?? catalog.efforts;
  if (baseEfforts.length === 0) return { model, effort: null };
  return { model: baseId, effort: rawEffort };
}

export function effortsForModel(
  catalog: ProviderModels,
  model: string | null,
): readonly EffortLevel[] {
  if (catalog.efforts.length === 0) return [];
  if (model === null) return catalog.efforts;
  const normalized = splitModelEffortVariant(catalog, model).model ?? model;
  const matched = catalog.models.find((item) => item.id === normalized);
  if (matched?.efforts !== undefined) return matched.efforts;
  if (
    normalized.includes('orchestrator') ||
    MODEL_EFFORT_SUFFIX.test(normalized) ||
    CLAUDE_NO_EFFORT_MODEL.test(normalized)
  ) {
    return [];
  }
  return catalog.efforts;
}

export function isEffortSupported(
  provider: ProviderId,
  effort: EffortLevel,
  model: string | null = null,
  catalog: ProviderModels = PROVIDER_MODELS[provider],
): boolean {
  return effortsForModel(catalog, model).includes(effort);
}

export function resolveModelConfig(input: {
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly effort: EffortLevel | null;
  readonly settings: Pick<Settings, 'models'>;
  readonly catalog?: ProviderModels;
}): { readonly model: string | null; readonly effort: EffortLevel | null } {
  const catalog = input.catalog ?? PROVIDER_MODELS[input.provider];
  const defaults = input.settings.models[input.provider];
  const rawModel = input.model ?? defaults.model;
  const split = splitModelEffortVariant(catalog, rawModel);
  const effectiveModel = split.model;
  const supportedEfforts = effortsForModel(catalog, effectiveModel);
  if (supportedEfforts.length === 0) {
    return { model: effectiveModel, effort: null };
  }
  const candidates: readonly (EffortLevel | null)[] = [input.effort, split.effort, defaults.effort];
  for (const candidate of candidates) {
    if (candidate !== null && supportedEfforts.includes(candidate)) {
      return { model: effectiveModel, effort: candidate };
    }
  }
  return { model: effectiveModel, effort: null };
}

// REGEX: strip ANSI CSI/OSC sequences emitted by CLI spinners
const ANSI_ESCAPE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]/g;
// REGEX: match `<model-id><tab or 2+ spaces><Display Name>` rows emitted by `agy models`
const AGY_MODEL_ROW = /^([A-Za-z0-9][A-Za-z0-9._:/-]+)(?:\t|\s{2,})(.+)$/;

interface AgyParsedRow {
  id: string;
  label: string;
  baseId: string | null;
  baseLabel: string | null;
  effort: EffortLevel | null;
}

function parseAgyCandidate(id: string, label: string): AgyParsedRow {
  const idMatch = MODEL_EFFORT_SUFFIX.exec(id);
  const labelMatch = LABEL_EFFORT_SUFFIX.exec(label);
  const idEffort = idMatch?.[2]?.toLowerCase();
  const labelEffort = labelMatch?.[2]?.toLowerCase();
  if (
    idMatch?.[1] &&
    labelMatch?.[1] &&
    idEffort &&
    idEffort === labelEffort &&
    isEffortLevel(idEffort)
  ) {
    return {
      id,
      label,
      baseId: idMatch[1],
      baseLabel: labelMatch[1].trim(),
      effort: idEffort,
    };
  }
  return { id, label, baseId: null, baseLabel: null, effort: null };
}

export function parseAgyModelsOutput(stdout: string): ModelOption[] {
  const cleaned = stdout.replace(ANSI_ESCAPE, '');
  const seen = new Set<string>();
  const rows: AgyParsedRow[] = [];
  const variantsByBase = new Map<string, Set<EffortLevel>>();

  for (const chunk of cleaned.split(/[\r\n]+/)) {
    const line = chunk.trim();
    const match = AGY_MODEL_ROW.exec(line);
    if (!match) continue;
    const id = match[1];
    const label = match[2]?.trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const row = parseAgyCandidate(id, label);
    rows.push(row);
    if (row.baseId !== null && row.effort !== null) {
      let set = variantsByBase.get(row.baseId);
      if (!set) {
        set = new Set<EffortLevel>();
        variantsByBase.set(row.baseId, set);
      }
      set.add(row.effort);
    }
  }

  const emittedBases = new Set<string>();
  const models: ModelOption[] = [];
  for (const row of rows) {
    if (row.baseId !== null && row.baseLabel !== null) {
      const variants = variantsByBase.get(row.baseId);
      if (variants && variants.size >= 2) {
        if (emittedBases.has(row.baseId)) continue;
        emittedBases.add(row.baseId);
        const sortedEfforts = [...variants].sort(
          (a, b) => EFFORT_LEVELS.indexOf(a) - EFFORT_LEVELS.indexOf(b),
        );
        models.push({ id: row.baseId, label: row.baseLabel, efforts: sortedEfforts });
        continue;
      }
    }
    models.push({ id: row.id, label: row.label });
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
