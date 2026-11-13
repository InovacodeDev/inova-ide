import type { ExecutionMode, ProviderId } from './types.js';

export const EXECUTION_MODES: readonly ExecutionMode[] = [
  'auto',
  'manual',
  'accept-edits',
  'plan',
  'bypass',
  'read-only',
];

const EXECUTION_MODE_SET: ReadonlySet<string> = new Set(EXECUTION_MODES);

export interface ProviderModeOption {
  id: ExecutionMode;
  label: string;
  description: string;
  badge?: 'Recomendado' | 'Padrão';
  headlessNote?: string;
}

export interface ProviderModeCatalog {
  title: string;
  defaultMode: ExecutionMode;
  options: readonly ProviderModeOption[];
}

const HEADLESS_MANUAL_NOTE =
  'Em chat sem TTY, aprovações de ferramentas podem ser negadas; use Aceitar edições ou Automático para editar arquivos.';

export const PROVIDER_MODES: Record<ProviderId, ProviderModeCatalog> = {
  claude: {
    title: 'Modo',
    defaultMode: 'accept-edits',
    options: [
      {
        id: 'auto',
        label: 'Automático',
        description: 'Claude gerencia decisões de permissão',
        badge: 'Recomendado',
      },
      {
        id: 'manual',
        label: 'Manual',
        description: 'Sempre perguntar antes de fazer alterações',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'accept-edits',
        label: 'Aceitar edições',
        description: 'Aceitar todas as edições automaticamente',
        badge: 'Padrão',
      },
      {
        id: 'plan',
        label: 'Plano',
        description: 'Criar um plano antes de fazer alterações',
      },
      {
        id: 'bypass',
        label: 'Ignorar permissões',
        description: 'Aceita todas as permissões',
      },
    ],
  },
  gemini: {
    title: 'Permissões locais',
    defaultMode: 'bypass',
    options: [
      {
        id: 'manual',
        label: 'Request Review',
        description: 'Exigir revisão e sandbox em cada comando',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'accept-edits',
        label: 'Default',
        description: 'Perguntar antes de operações sensíveis',
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Decidir automaticamente se comandos executam',
      },
      {
        id: 'plan',
        label: 'Plano',
        description: 'Planejar mudanças antes de editar arquivos',
      },
      {
        id: 'bypass',
        label: 'Turbo',
        description: 'Executar todos os comandos sem restrições',
        badge: 'Padrão',
      },
    ],
  },
  codex: {
    title: 'Sandbox e permissões',
    defaultMode: 'accept-edits',
    options: [
      {
        id: 'read-only',
        label: 'Somente leitura',
        description: 'Bloquear gravação no disco',
      },
      {
        id: 'accept-edits',
        label: 'Workspace Write',
        description: 'Permitir edições no workspace',
        badge: 'Padrão',
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Aprovar ações seguras no workspace',
      },
      {
        id: 'bypass',
        label: 'Turbo / Bypass',
        description: 'Ignorar aprovações e sandbox',
      },
    ],
  },
  qwen: {
    title: 'Modo de aprovação',
    defaultMode: 'bypass',
    options: [
      {
        id: 'plan',
        label: 'Plano',
        description: 'Elaborar plano antes de aplicar mudanças',
      },
      {
        id: 'manual',
        label: 'Default',
        description: 'Modo padrão com checagem de aprovação',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'accept-edits',
        label: 'Auto Edit',
        description: 'Aceitar edições de arquivos automaticamente',
      },
      {
        id: 'bypass',
        label: 'YOLO',
        description: 'Executar todas as ações sem bloqueio',
        badge: 'Padrão',
      },
    ],
  },
  kimi: {
    title: 'Modo',
    defaultMode: 'accept-edits',
    options: [
      {
        id: 'manual',
        label: 'Padrão',
        description: 'Execução sem flags automáticas',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'accept-edits',
        label: 'YOLO',
        description: 'Aceitar ações e edições automaticamente',
        badge: 'Padrão',
      },
      {
        id: 'bypass',
        label: 'Auto',
        description: 'Executar fluxo contínuo sem pausas',
      },
    ],
  },
  grok: {
    title: 'Modo',
    defaultMode: 'bypass',
    options: [
      {
        id: 'manual',
        label: 'Padrão',
        description: 'Executar sem aprovação automática',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'bypass',
        label: 'Sempre aprovar',
        description: 'Aprovar comandos automaticamente',
        badge: 'Padrão',
      },
    ],
  },
  opencode: {
    title: 'Modo',
    defaultMode: 'auto',
    options: [
      {
        id: 'manual',
        label: 'Padrão',
        description: 'Executar sem modo automático',
        headlessNote: HEADLESS_MANUAL_NOTE,
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Aprovar execução automaticamente',
        badge: 'Padrão',
      },
    ],
  },
  deepseek: {
    title: 'Modo',
    defaultMode: 'accept-edits',
    options: [
      {
        id: 'read-only',
        label: 'Somente leitura',
        description: 'Impedir alterações em arquivos',
      },
      {
        id: 'accept-edits',
        label: 'Workspace Write',
        description: 'Permitir gravação no workspace',
        badge: 'Padrão',
      },
    ],
  },
};

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && EXECUTION_MODE_SET.has(value);
}

export function isModeSupported(provider: ProviderId, mode: ExecutionMode): boolean {
  return PROVIDER_MODES[provider].options.some((opt) => opt.id === mode);
}

export function resolveExecutionMode(input: {
  provider: ProviderId;
  sessionMode?: ExecutionMode | null;
  defaultModes?: Partial<Record<ProviderId, ExecutionMode>>;
}): ExecutionMode {
  const { provider, sessionMode, defaultModes } = input;
  if (sessionMode && isModeSupported(provider, sessionMode)) {
    return sessionMode;
  }
  const storeDefault = defaultModes?.[provider];
  if (storeDefault && isModeSupported(provider, storeDefault)) {
    return storeDefault;
  }
  return PROVIDER_MODES[provider].defaultMode;
}
