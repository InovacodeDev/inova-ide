import type { LocalePreference, SupportedLocale } from '@inova/core/types';

export function resolveLocale(
  preference: LocalePreference | undefined,
  systemLocale: string,
): SupportedLocale {
  if (preference === 'pt-BR' || preference === 'en-US') return preference;
  return /^en(?:-|$)/i.test(systemLocale) ? 'en-US' : 'pt-BR';
}

const PT_BR = {
  'alerts.unexpected': 'Erro inesperado.',
  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',
  'common.save': 'Salvar',
  'common.saving': 'Salvando...',

  'header.running': '{count} executando',
  'header.commands': 'Comandos',
  'header.commandsLabel': 'Abrir paleta de comandos',
  'header.commandsTooltip': 'Paleta de comandos',
  'header.settingsLabel': 'Configurações',
  'header.settingsTooltip': 'Abrir configurações',
  'header.restartToUpdate': 'Reiniciar para atualizar',
  'header.updating': 'Atualizando…',
  'header.updateTooltip': 'Instalar a versão v{version} e reiniciar',

  'footer.ariaLabel': 'Provedores conectados',
  'footer.noConnectedAccounts': 'Nenhuma conta conectada',
  'footer.inUse': 'em uso',
  'footer.manageAccounts': 'Gerenciar contas',
  'footer.manageAccountsTooltip': 'Abrir contas e providers',
  'footer.accountSingular': 'conta',
  'footer.accountPlural': 'contas',
  'footer.alertsLabel': 'Histórico de alertas ({count})',
  'footer.alertsTooltip': 'Alertas recentes',
  'footer.alertsTitle': 'Alertas recentes',
  'footer.alertsEmpty': 'Nenhum alerta registrado nesta sessão.',
  'footer.alertsClear': 'Limpar',

  'settings.title': 'Configurações',
  'settings.close': 'Fechar configurações',
  'settings.theme.title': 'Tema',
  'settings.theme.desc': 'Sistema segue a aparência do seu computador.',
  'settings.theme.system': 'Sistema',
  'settings.theme.dark': 'Escuro',
  'settings.theme.light': 'Claro',
  'settings.locale.title': 'Idioma',
  'settings.locale.desc': 'Define o idioma dos textos e formatos da interface.',
  'settings.locale.auto': 'Sistema',
  'settings.locale.ptBR': 'Português (Brasil)',
  'settings.locale.enUS': 'English',

  'sidebar.nav.workspace': 'Workspace',
  'sidebar.nav.agents': 'Agentes',
  'sidebar.nav.compare': 'Comparar',
  'sidebar.nav.accounts': 'Contas',
  'sidebar.nav.inbox': 'Caixa de entrada',
  'sidebar.newSession': 'Nova sessão',
  'sidebar.projects': 'Projetos',
  'sidebar.openFolder': 'Abrir pasta',
  'sidebar.noSessions': 'Nenhuma sessão',
  'sidebar.moreActions': 'Mais ações do projeto',
  'sidebar.projectSettings': 'Configurações do projeto',
  'sidebar.profileSync': 'Sincronizar MCPs e regras',
  'sidebar.importSessions': 'Importar sessões externas',
  'sidebar.removeProject': 'Remover projeto',
  'sidebar.removeProjectTitle': 'Remover projeto',
  'sidebar.removeProjectDesc':
    'Remover o projeto "{name}" da lista? Todas as sessões e subsessões vinculadas a ele serão removidas da IDE.',
  'sidebar.removeProjectConfirm': 'Remover projeto',
  'sidebar.sessionActions': 'Ações da sessão',
  'sidebar.rename': 'Renomear',
  'sidebar.newSubsession': 'Nova subsessão',
  'sidebar.archive': 'Arquivar',
  'sidebar.unarchive': 'Desarquivar',
  'sidebar.delete': 'Excluir',
  'sidebar.showMore': 'Mostrar mais ({count})',
  'sidebar.showLess': 'Mostrar menos',
  'sidebar.archived': 'Arquivadas ({count})',

  'details.pinnedMemory': 'Memória fixada',
  'details.pinnedMemoryConfigured': 'Definida',
  'details.handoff': 'Handoff',

  'chat.handoff': 'Handoff',

  'newSession.title': 'Nova sessão',
  'newSession.projectInheritHint':
    'Provider e conta são herdados da pasta do projeto selecionado. Para escolher outro, selecione «Outro diretório».',
  'newSession.firstMessage': 'Primeira mensagem (opcional)',
  'newSession.worktree': 'Isolar sessão em Git worktree',
  'newSession.start': 'Iniciar sessão',
} as const;

export type TranslationKey = keyof typeof PT_BR;

const EN_US: Record<TranslationKey, string> = {
  'alerts.unexpected': 'Unexpected error.',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.saving': 'Saving...',

  'header.running': '{count} running',
  'header.commands': 'Commands',
  'header.commandsLabel': 'Open command palette',
  'header.commandsTooltip': 'Command palette',
  'header.settingsLabel': 'Settings',
  'header.settingsTooltip': 'Open settings',
  'header.restartToUpdate': 'Restart to update',
  'header.updating': 'Updating…',
  'header.updateTooltip': 'Install v{version} and restart',

  'footer.ariaLabel': 'Connected providers',
  'footer.noConnectedAccounts': 'No connected accounts',
  'footer.inUse': 'active',
  'footer.manageAccounts': 'Manage accounts',
  'footer.manageAccountsTooltip': 'Open accounts and providers',
  'footer.accountSingular': 'account',
  'footer.accountPlural': 'accounts',
  'footer.alertsLabel': 'Alert history ({count})',
  'footer.alertsTooltip': 'Recent alerts',
  'footer.alertsTitle': 'Recent alerts',
  'footer.alertsEmpty': 'No alerts recorded in this session.',
  'footer.alertsClear': 'Clear',

  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.theme.title': 'Theme',
  'settings.theme.desc': 'System matches your operating system appearance.',
  'settings.theme.system': 'System',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.locale.title': 'Language',
  'settings.locale.desc': 'Sets UI labels and formatting locale.',
  'settings.locale.auto': 'System',
  'settings.locale.ptBR': 'Português (Brasil)',
  'settings.locale.enUS': 'English',

  'sidebar.nav.workspace': 'Workspace',
  'sidebar.nav.agents': 'Agents',
  'sidebar.nav.compare': 'Compare',
  'sidebar.nav.accounts': 'Accounts',
  'sidebar.nav.inbox': 'Inbox',
  'sidebar.newSession': 'New session',
  'sidebar.projects': 'Projects',
  'sidebar.openFolder': 'Open folder',
  'sidebar.noSessions': 'No sessions',
  'sidebar.moreActions': 'More project actions',
  'sidebar.projectSettings': 'Project settings',
  'sidebar.profileSync': 'Sync MCPs and rules',
  'sidebar.importSessions': 'Import external sessions',
  'sidebar.removeProject': 'Remove project',
  'sidebar.removeProjectTitle': 'Remove project',
  'sidebar.removeProjectDesc':
    'Remove project "{name}" from the list? Linked sessions and subsessions will be removed from the IDE.',
  'sidebar.removeProjectConfirm': 'Remove project',
  'sidebar.sessionActions': 'Session actions',
  'sidebar.rename': 'Rename',
  'sidebar.newSubsession': 'New subsession',
  'sidebar.archive': 'Archive',
  'sidebar.unarchive': 'Unarchive',
  'sidebar.delete': 'Delete',
  'sidebar.showMore': 'Show more ({count})',
  'sidebar.showLess': 'Show less',
  'sidebar.archived': 'Archived ({count})',

  'details.pinnedMemory': 'Pinned memory',
  'details.pinnedMemoryConfigured': 'Set',
  'details.handoff': 'Handoff',

  'chat.handoff': 'Handoff',

  'newSession.title': 'New session',
  'newSession.projectInheritHint':
    'Provider and account are inherited from the selected project folder. Choose «Other directory» to pick another.',
  'newSession.firstMessage': 'First message (optional)',
  'newSession.worktree': 'Isolate session in Git worktree',
  'newSession.start': 'Start session',
};

export const MESSAGES: Record<SupportedLocale, Record<TranslationKey, string>> = {
  'pt-BR': PT_BR,
  'en-US': EN_US,
};

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES['pt-BR'][key];
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : full,
  );
}
