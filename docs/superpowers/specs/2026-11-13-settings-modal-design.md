# Inova IDE: Tela de Configurações

Data: 2026-11-13 · Status: fase 1 implementada · Branch: `feat/settings-modal`

## Mudanças na implementação

- O padrão de `voice.modelId` é `large-v3-turbo-q5_0`, o modelo que o código já usava (commit `746e31c`).
- Tema entrou na fase 1: `appearance.theme` (`system`, `dark`, `light`), padrão `dark`. O tema claro troca o fundo pelo texto e mantém o laranja. A logo inverte com o tema.
- A caixa de entrada usa `mod+shift+U`, para não conflitar com o DevTools.
- O arquivamento automático considera a atividade de toda a subárvore da sessão, não só da raiz.
- O botão de engrenagem fica no cabeçalho. A versão do app não aparece na seção Geral.

## Problema e objetivo

O app não tem um lugar único para preferências. O modelo de voz é fixo em `apps/desktop/src/main/voice.ts:10`. A notificação nativa dispara sem opção de desligar em `apps/desktop/src/main/handlers.ts:346`. O arquivamento de sessão é só manual. O app não tem atalhos globais de teclado.

O objetivo é um modal de configurações, aberto por `Cmd+,` no macOS e `Ctrl+,` no Windows e no Linux. O modal reúne as preferências do app e uma tela de atalhos de teclado.

## Suposições

- "Configurações do projeto" significa configurações do app (globais). Preferência por projeto fica fora da fase 1.
- A fase 1 lista os atalhos e cria os atalhos globais. A troca de tecla pelo usuário fica na fase 2.
- O app tem um tema só (`tokens.css` não tem `data-theme`). Tema fica na fase 3.

## Modelo de dados em `@inova/core`

Adicionar `settings?: Settings` em `Store` (`src/core/types.ts:85`). O campo usa o mesmo arquivo, o mesmo `withStoreLock` e o mesmo padrão de `defaultModes`. Campo ausente significa padrão.

```typescript
export type VoiceModelId = 'base' | 'small-q5_1' | 'medium-q5_0' | 'large-v3-turbo-q5_0';

export interface Settings {
  voice: {
    modelId: VoiceModelId;
    language: 'auto' | 'pt' | 'en' | 'es';
  };
  sessions: {
    autoArchiveDays: 0 | 1 | 3 | 7 | 30;
    collapseFinishedTurns: boolean;
  };
  notifications: {
    waitingInput: boolean;
    failed: boolean;
    completed: boolean;
    onlyWhenUnfocused: boolean;
  };
}
```

Padrões (iguais ao comportamento de hoje, para não mudar nada sem o usuário pedir):

| Campo | Padrão | Motivo |
| --- | --- | --- |
| `voice.modelId` | `small-q5_1` | Modelo atual |
| `voice.language` | `auto` | Hoje usa `navigator.language` (`useDictation.ts:62`) |
| `sessions.autoArchiveDays` | `0` (desligado) | Hoje não existe |
| `sessions.collapseFinishedTurns` | `true` | Comportamento atual do chat |
| `notifications.waitingInput` | `true` | Já notifica hoje |
| `notifications.failed` | `true` | Já notifica hoje |
| `notifications.completed` | `false` | Hoje não notifica |
| `notifications.onlyWhenUnfocused` | `true` | Hoje só notifica com a janela sem foco |

Novo arquivo `src/core/settings.ts`:

- `DEFAULT_SETTINGS`.
- `isSettings(value)`: valida cada campo. `isStore` (`src/core/store.ts:134`) chama esta função.
- `getSettings(root)`: carrega o store e mescla com `DEFAULT_SETTINGS`.
- `updateSettings({ root, patch })`: aplica um patch parcial por seção, dentro de `withStoreLock`.

`defaultModes` continua no lugar atual. O modal edita `defaultModes` pelo `setDefaultMode` que já existe.

## IPC (`@inova/desktop`)

| Canal | Entrada | Saída |
| --- | --- | --- |
| `inova:getSettings` | nada | `Result<Settings>` |
| `inova:updateSettings` | patch parcial | `Result<Settings>` |
| `inova:deleteVoiceModel` | `{ modelId }` | `Result<VoiceStatus>` |

- `main/validation.ts`: `parseSettingsPatch` valida o patch na fronteira. Chave desconhecida ou valor fora do enum rejeita o patch inteiro.
- `getVoiceStatus` e `downloadVoiceModel` já existem. `VoiceStatus` ganha `modelId` e a lista de modelos instalados.
- Um endpoint só para atualizar (`updateSettings`). Não criar um canal por campo.

## Modal (`renderer/SettingsModal.tsx`)

Reusar `.modal-backdrop`, `.modal-card`, `.modal-header` e `.modal-body` de `modal.css`. O card é mais largo (cerca de 760px) e tem navegação lateral à esquerda. `Esc` e clique fora fecham, como no `ConfirmModal`.

Cada alteração salva na hora (`updateSettings`). O modal não tem botão "Salvar". Se o IPC falhar, o controle volta ao valor anterior e o erro aparece pelo `useWarning`.

O `App.tsx` carrega `settings` uma vez na abertura, como faz com `defaultModes` (`App.tsx:75`), e passa as seções para quem usa.

### Seções da fase 1

**Geral**

- Modo de execução padrão por provedor. Reusa `ModePicker` e `setDefaultMode`.
- Versão do app e botão "Abrir pasta de dados".

**Sessões**

- "Arquivar sessões automaticamente": Nunca, 1, 3, 7 ou 30 dias sem atividade.
- "Recolher turnos concluídos" (liga/desliga).

Regra do arquivamento automático, no processo principal:

1. Rodar ao abrir o app e a cada hora.
2. Selecionar sessão raiz com `archivedAt === null` e `updatedAt` mais antigo que o limite.
3. Pular sessão em execução, sessão com descendente em execução, sessão aberta em aba e sessão com item não lido na caixa de entrada.
4. Arquivar pelo `updateSession({ patch: { archived: true } })` que já existe (`src/core/sessions.ts:266`). A subárvore vai junto, como no arquivamento manual.

A seleção fica em função pura `sessionsToAutoArchive({ sessions, now, days, busyIds })` em `src/core/sessions.ts`, com teste.

**Notificações**

- "Agente aguarda sua ação" (`waiting-input`).
- "Agente falhou" (`failed`).
- "Agente terminou" (`completed`).
- "Só notificar com a janela sem foco".
- Botão "Enviar notificação de teste".

A condição em `handlers.ts:346` passa a ler `settings.notifications`. Os três tipos já existem em `InboxAttentionKind` (`src/core/types.ts:58`).

**Voz**

- Lista de modelos com tamanho, estado (instalado, não instalado, baixando com percentual) e ações Baixar, Usar e Remover.
- Idioma do ditado: Automático, Português, Inglês, Espanhol.
- Estado do binário `whisper-cli` (encontrado ou a dica de instalação que já existe).

`VOICE_MODEL` vira o catálogo `VOICE_MODELS: Record<VoiceModelId, { file; url; bytes; sha256; label }>`. `createVoiceService` recebe o `modelId` ativo por função (`getModelId`), para a troca valer sem reiniciar.

| Modelo | Tamanho aproximado | Uso |
| --- | --- | --- |
| `base` | 150 MB | Máquina fraca, menor precisão |
| `small-q5_1` | 190 MB | Padrão atual |
| `medium-q5_0` | 540 MB | Mais precisão em português |
| `large-v3-turbo-q5_0` | 570 MB | Melhor precisão, mais lento em CPU |

CUIDADO: `bytes` e `sha256` de cada modelo novo vêm do repositório real no Hugging Face na hora de implementar. Não escrever valor de cabeça. Os tamanhos da tabela são aproximados.

Remover o modelo ativo volta o ditado para o estado `needs-model` que já existe em `useDictation.ts`.

**Atalhos de teclado**

Tabela agrupada, só leitura na fase 1. A tecla aparece no formato da plataforma (`⌘,` no macOS, `Ctrl+,` nos outros).

## Atalhos de teclado

Novo arquivo `renderer/shortcuts.ts`:

```typescript
export interface ShortcutDef {
  id: ShortcutId;
  group: 'Geral' | 'Sessões' | 'Abas' | 'Composer';
  label: string;
  binding: string;
}
```

- `binding` usa `mod` para `Cmd` no macOS e `Ctrl` nos outros (exemplo: `mod+,`).
- `matchShortcut(event, binding, isMac)`: função pura, com teste.
- `formatBinding(binding, isMac)`: texto para exibir.
- Um único listener de `keydown` no `App.tsx` percorre o catálogo e chama a ação. A tela de atalhos lê o mesmo catálogo. Assim a lista nunca diverge do comportamento.

| Ação | Tecla | Estado hoje |
| --- | --- | --- |
| Abrir configurações | `mod+,` | Novo |
| Nova sessão | `mod+N` | Novo |
| Fechar aba | `mod+W` | Novo |
| Aba 1 a 9 | `mod+1` … `mod+9` | Novo |
| Aba anterior / próxima | `mod+shift+[` / `mod+shift+]` | Novo |
| Abrir caixa de entrada | `mod+shift+I` | Novo |
| Arquivar sessão atual | `mod+shift+A` | Novo |
| Focar o composer | `mod+L` | Novo |
| Iniciar / parar ditado | `mod+shift+D` | Novo |
| Enviar mensagem | `Enter` | Existe (`ChatView.tsx:767`), só listar |
| Criar sessão no formulário | `mod+Enter` | Existe (`NewSessionView.tsx:103`), só listar |
| Fechar modal ou popover | `Esc` | Existe, só listar |

Regras:

- O listener ignora o evento quando um modal diferente do de configurações está aberto.
- `mod+W` no Windows e no Linux fecha a janela por padrão do Electron. O listener chama `preventDefault` quando existe aba aberta.
- `mod+shift+I` abre o DevTools em desenvolvimento. Se houver conflito no build de produção, trocar para `mod+shift+U` antes de implementar.

## Fases

**Fase 1 (este spec)**

1. `Settings` no core: tipos, `isSettings`, `getSettings`, `updateSettings`, testes.
2. IPC `getSettings` / `updateSettings` e `parseSettingsPatch`, testes.
3. `shortcuts.ts`, listener global e `mod+,`, testes de `matchShortcut`.
4. `SettingsModal` com as cinco seções.
5. Notificações lendo `settings`.
6. Catálogo de modelos de voz, troca e remoção.
7. Arquivamento automático.

As tarefas 5, 6 e 7 são independentes entre si depois que 1 e 2 entram.

**Fase 2**

- Troca de tecla pelo usuário (`settings.keybindings: Partial<Record<ShortcutId, string>>`), com detecção de conflito e "Restaurar padrão".
- Item "Configurações…" no menu nativo do macOS. Exige montar um `Menu` próprio, porque hoje o app usa o menu padrão do Electron.
- Som na notificação e contador no ícone do Dock.
- Modelo e esforço padrão por provedor.

**Fase 3 (futuro, só quando houver pedido)**

- Aparência: tema claro/escuro, tamanho da fonte, densidade.
- Git: pasta padrão de worktree, limpeza automática de worktree de sessão arquivada.
- Provedores: caminho do binário de cada CLI, variáveis de ambiente extras.
- Dados: exportar e importar configurações, apagar sessões arquivadas há mais de N dias.
- Atualizações: verificar e instalar nova versão.
- Preferência por projeto, que sobrepõe a global.

## Trade-offs

| Decisão | Escolha | Alternativa descartada | Motivo |
| --- | --- | --- | --- |
| Onde gravar | `Store.settings` no store atual | Arquivo `settings.json` separado | Reusa lock, validação e migração. Um arquivo só para backup. |
| Onde tratar `mod+,` | Listener no renderer | `Menu` nativo com accelerator | O catálogo já é necessário para a tela de atalhos. Menu nativo exige recriar o menu padrão inteiro. |
| Salvar | Na hora, por campo | Botão "Salvar" | Padrão de preferências no macOS. Menos estado no modal. |
| Arquivamento automático | Timer no processo principal | Rodar no renderer | Funciona com qualquer janela e usa o `updateSession` do core. |
| Formato do modal | Modal com navegação lateral | Aba nova no workspace | Pedido do usuário. Não ocupa o espaço das sessões. |

## Critérios de pronto

- `mod+,` abre o modal nas três plataformas. `Esc` fecha.
- Uma alteração continua valendo depois de reiniciar o app.
- Store antigo, sem `settings`, carrega com os padrões e sem erro.
- Com "Agente terminou" ligado, uma sessão concluída com a janela sem foco gera notificação. Com tudo desligado, nenhuma notificação aparece.
- A troca de modelo de voz vale na próxima gravação, sem reiniciar.
- Sessão em execução ou aberta em aba nunca é arquivada pelo arquivamento automático.
- `pnpm run typecheck`, `pnpm run lint` e `pnpm run test` passam.
