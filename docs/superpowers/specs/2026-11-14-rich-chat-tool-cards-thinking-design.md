# Design: Subprojeto 1 — Chat Rico, Tool Cards, Status Vivo e Raciocínio

Data: 2026-11-14
Status: Aprovado

## Roadmap de Evolução de UI

Esta entrega executa o Subprojeto 1 de um roadmap sequencial em 4 etapas:

| Subprojeto | Escopo | Status |
| --- | --- | --- |
| 1. Chat Rico, Tool Cards, Status Vivo e Raciocínio | Tool cards especializados, eventos de raciocínio, status vivo e estado vazio rico | Concluído |
| 2. Shell Unificado e Inspector Encaixável | Unificação do topo e painel direito fixo com abas | Concluído |
| 3. Alterações Git e Diff Viewer na Sessão | Lista de arquivos alterados, diff por arquivo e reversão granular | Concluído |
| 4. Command Palette (`⌘K`) | Navegação rápida por sessões, projetos, modelos e ações | Concluído |

## Arquitetura do Subprojeto 1

### 1. Eventos de Raciocínio (`src/core` e `apps/desktop/src/main`)

O tipo `ChatEvent` passa a incluir `thinking-delta` e `thinking`:

- `Claude`: `fromStreamEvent` emite `thinking-delta` para `content_block_delta` com `delta.type === 'thinking_delta'` quando não vazio. `fromAssistant` emite `thinking` para blocos `type === 'thinking'` quando não vazios.
- `Gemini`: `parseStepUpdate` emite `thinking` quando `step.state === 'DONE'` e `step.thinking` contém texto não vazio.
- `Codex`: `fromItem` emite `thinking` quando `item.type === 'reasoning'` e `item.text` contém texto não vazio.
- `DeepSeek / Kimi / Grok / Qwen / OpenCode`: `fromMessage` emite `thinking` para `reasoning_content` ou blocos `type === 'thinking'` não vazios.
- Persistência: `handlers.ts` grava `thinking` no transcript JSONL e ignora `thinking-delta`. `chat.ts` restaura `thinking` em `parseTranscriptLine`.

### 2. Estado do Chat e Agrupamento (`apps/desktop/src/renderer`)

- `chat-reducer.ts`: adiciona `ChatItem` do tipo `thinking` (`{ type: 'thinking', id, text, streaming }`), acumula `thinking-delta`, substitui em `thinking` e fecha `streaming: false` em `done` e `loadTranscript`.
- `agent-tail.ts`: inclui `case 'thinking'` no switch exaustivo de `itemText`.
- `turn-groups.ts`:
  - `groupTurn`: inclui blocos `thinking` dentro de `Trabalho do turno` em turnos anteriores finalizados.
  - `summarizeWork`: adiciona `raciocínio` quando há blocos `thinking` e soma `(+X -Y)` quando há diffs em edições.
  - `activeTurnActivity`: retorna o rótulo da atividade atual do turno ativo (`Editando arquivo…`, `Executando comando…`, `Consultando…`, `Raciocinando…` ou `Pensando…`).

### 3. Apresentação Estruturada de Ferramentas (`tool-presentation.ts`)

Função pura `presentTool(item)` mapeia entradas de ferramentas para 5 apresentações tipadas:

1. `edit` (`Edit`, `MultiEdit`, `Write`, `edit_file`, `write_file`, `write_to_file`, `replace_file_content`): calcula diff unificado por linha (`add`, `del`, `ctx`), numeração antiga/nova e contadores `+N` / `-M`.
2. `shell` (`Bash`, `run_command`, `command_execution`): extrai comando, descrição e linhas de saída.
3. `lookup` (`Read`, `read_file`, `Grep`, `grep_search`, `Glob`, `find_by_name`, `LS`, `WebSearch`, `WebFetch`, `search_web`): normaliza rótulo (`Leitura`, `Busca`, `Arquivos`, `Web`), alvo e contagem de resultados.
4. `todo` (`TodoWrite`): extrai tarefas e progresso `concluídas/total`.
5. `generic`: exibe título resumido e pares chave-valor quando a entrada é objeto JSON.

### 4. Componentes Visuais (`ChatView.tsx` e `chat.css`)

- `ToolCard`: renderiza cartões específicos por `kind`. Cartões `edit` iniciam abertos no turno mais recente e fechados nos turnos anteriores, com truncamento em 120 linhas e botão de expansão.
- `ThinkingCard`: card recolhível `<details>` aberto durante `streaming` e fechado após conclusão.
- `LiveTurnStatus`: barra viva com indicador pulsante, atividade retornada por `activeTurnActivity` e cronômetro (`0:00s`) atualizado a cada segundo enquanto o turno executa.
- `ChatEmptyState`: card inicial com provedor, modelo, pasta de trabalho, indicação de worktree e chips de prompts rápidos.

## Arquitetura do Subprojeto 2

### 1. Estado do Inspector (`inspector-state.ts`)

- `subagentSummaryCounts`: totaliza subagentes por status (`running`, `done`, `error`) e soma tokens consumidos.
- `inspectorTabs`: gera metadados das abas `Contexto`, `Subagentes` (badge `ativos/total` ou `total`) e `Sessão` (badge `wt` quando em worktree).

### 2. Topo Unificado e Toolbar Enxuta (`Header.tsx`, `SessionHeader.tsx`, `App.tsx`)

- `Header`: recebe as abas abertas (`TabBar`) diretamente em `.app-header-tabs`, eliminando a barra separada acima do chat.
- `SessionHeader`: barra única compacta com breadcrumb do projeto, título editável, status, resumo de conta/worktree, ações rápidas e botão de alternância do inspector direito.

### 3. Rail Lateral e Inspector Acoplável (`sidebar.css`, `session.css`, `SessionDetails.tsx`)

- `sidebar-rail`: convertido de card flutuante absoluto para trilho fixo vertical (`52px`) de altura total, sem sobrepor mensagens nem exigir `rail-offset`.
- `SessionDetails`: painel direito acoplável (`300px`) lado a lado em `.session-stage` (`flex-direction: row`), com abas `Contexto`, `Git`, `Subagentes` e `Sessão`.

## Arquitetura do Subprojeto 3

### 1. Core e Reversão Granular (`src/core` e `apps/desktop/src/main`)

- `git-worktree.ts`: `getWorktreeStatus` valida `baseCommit` via `git rev-parse --verify --quiet` antes de montar a árvore de snapshot, retornando status vazio quando não há commit base.
- `git-checkpoints.ts`: `restoreCheckpoint` aceita `files?: readonly string[]` para restaurar ou remover apenas os caminhos selecionados, mantendo o fluxo integral quando omitido.
- `handlers.ts` e `validation.ts`: `getWorktreeStatus` atende sessões em worktree isolado (`baseCommit`) e sessões no diretório principal (`HEAD`). `parseRestoreCheckpoint` aceita `files` relativos validados sem traversal e `restoreCheckpoint` resolve `ref ?? session.worktree?.baseCommit ?? 'HEAD'`.

### 2. Parser de Diff e Inspetor Git (`git-diff-presentation.ts`, `inspector-state.ts`, `useSessionGitStatus.ts`)

- `parseUnifiedGitDiff`: estrutura blocos `diff --git` em arquivos com status (`added`, `modified`, `deleted`, `renamed`), detecção de binário, contadores `+N / -M` e numeração por hunk/linha.
- `inspectorTabs`: inclui a aba `Git` (`changes`) com badge indicando a contagem de arquivos modificados.
- `useSessionGitStatus`: consulta `window.inova.getWorktreeStatus` quando a sessão troca, inicia/termina execução ou sofre mutação.

### 3. Lista na Aba Git e Modal Split (`SessionDetails.tsx`, `SessionDiffModal.tsx`, `App.tsx`)

- Aba `Git` em `SessionDetails`: mostra resumo `+X / -Y`, lista arquivos alterados com abertura direta do diff no arquivo clicado e botões de reversão por arquivo ou em lote.
- `SessionDiffModal`: substitui o bloco `<pre>` simples por layout dividido com lista lateral à esquerda, diff numerado por hunk à direita, reversão por arquivo, reversão total e aplicação do worktree no projeto principal.

## Arquitetura do Subprojeto 4

### 1. Estado e Busca da Command Palette (`command-palette-state.ts`, `shortcuts.ts`, `useGlobalShortcuts.ts`)

- `buildCommandPaletteItems`: agrega ações globais, sessões (priorizando sessão ativa e ocultando arquivadas apenas atrás do filtro), projetos vinculados, modelos disponíveis para a conta da sessão ativa e modos de execução suportados pelo provedor ativo.
- `filterCommandPaletteItems` e `groupCommandPaletteItems`: busca multi-token com pontuação por título, subtítulo, categoria, badge e keywords, mantendo agrupamento canônico (`Ações`, `Sessões`, `Projetos`, `Modelos`, `Modos`).
- `shortcuts.ts` e `useGlobalShortcuts.ts`: adiciona o atalho global `open-command-palette` (`⌘P` no macOS / `Ctrl+P` nos demais sistemas) sem colidir com atalhos de formatação do composer.

### 2. Interface e Integração (`CommandPaletteModal.tsx`, `Header.tsx`, `App.tsx`)

- `CommandPaletteModal`: diálogo acessível com campo de busca em foco automático, navegação circular por teclado (`↑`/`↓`, `Enter`, `Esc`), badges de item ativo e exibição do atalho de cada ação.
- `Header` e `App`: botão `Comandos` no topo unificado e despacho direto para trocar de aba/sessão, abrir nova sessão no projeto, alternar modelo, modo, barras laterais, diff Git ou verificação do projeto.
