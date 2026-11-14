import type { ProviderId } from './types.js';

export type SlashCommandAction = 'passthrough' | 'clear' | 'model-picker';

export interface NativeSlashCommand {
  name: string;
  description: string;
  action: SlashCommandAction;
}

const NATIVE_SLASH_COMMANDS: Record<ProviderId, readonly NativeSlashCommand[]> = {
  claude: [
    { name: 'clear', description: 'Limpa a conversa e a memória do agente', action: 'clear' },
    {
      name: 'compact',
      description: 'Resume a conversa para liberar contexto',
      action: 'passthrough',
    },
    {
      name: 'init',
      description: 'Cria o arquivo de instruções do projeto',
      action: 'passthrough',
    },
    { name: 'review', description: 'Revisa as mudanças atuais', action: 'passthrough' },
    {
      name: 'security-review',
      description: 'Revisão de segurança das mudanças do branch',
      action: 'passthrough',
    },
    { name: 'mcp', description: 'Mostra o estado dos servidores MCP', action: 'passthrough' },
    { name: 'model', description: 'Troca o modelo e o esforço', action: 'model-picker' },
    { name: 'effort', description: 'Ajusta o esforço de raciocínio', action: 'model-picker' },
  ],
  codex: [
    { name: 'new', description: 'Inicia uma conversa nova', action: 'clear' },
    { name: 'model', description: 'Troca o modelo', action: 'model-picker' },
  ],
  gemini: [{ name: 'model', description: 'Troca o modelo', action: 'model-picker' }],
  deepseek: [{ name: 'model', description: 'Troca o modelo', action: 'model-picker' }],
  kimi: [
    { name: 'clear', description: 'Limpa a conversa e a memória do agente', action: 'clear' },
    { name: 'goal', description: 'Define um objetivo autônomo', action: 'passthrough' },
    { name: 'model', description: 'Troca o modelo', action: 'model-picker' },
  ],
  grok: [
    { name: 'clear', description: 'Limpa a conversa e a memória do agente', action: 'clear' },
    { name: 'model', description: 'Troca o modelo', action: 'model-picker' },
  ],
  qwen: [
    { name: 'clear', description: 'Limpa a conversa e a memória do agente', action: 'clear' },
    { name: 'diff', description: 'Resumo do diff atual', action: 'passthrough' },
    {
      name: 'btw',
      description: 'Pergunta paralela sem desviar a tarefa',
      action: 'passthrough',
    },
    { name: 'goal', description: 'Define um objetivo autônomo', action: 'passthrough' },
    { name: 'model', description: 'Troca o modelo', action: 'model-picker' },
  ],
  opencode: [
    { name: 'new', description: 'Inicia uma conversa nova', action: 'clear' },
    { name: 'models', description: 'Troca o modelo', action: 'model-picker' },
  ],
};

export function nativeSlashCommands(provider: ProviderId): readonly NativeSlashCommand[] {
  return NATIVE_SLASH_COMMANDS[provider];
}
