# Painéis flutuantes, abas, ações de mensagem e comandos `/` — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os blocos A (layout), B (mensagens/rewind) e C (comandos `/` e skills) do design.

**Architecture:** App Electron. Renderer React em `apps/desktop/src/renderer`, main em
`apps/desktop/src/main`, contrato IPC em `apps/desktop/src/shared/api.ts` + `preload/index.ts`,
lógica pura compartilhada em `src/core`. Lógica nova vai em módulos puros testáveis
(`*.ts` + `apps/desktop/test/*.test.ts`); componentes só consomem.

**Tech Stack:** TypeScript strict, React (function components), Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-13-floating-panels-tabs-message-actions-design.md`

## Global Constraints

- pnpm apenas. Nenhuma dependência nova.
- Sem comentários, exceto `REGEX:`, `ALGORITHM:`, `NOTE:`. Sem código comentado, sem TODO.
- Sem `any`; `unknown` + type guard. Funções com mais de 3 parâmetros recebem objeto.
- Mudanças de IPC e de `ChatEvent` são aditivas.
- Textos de UI em português (pt-BR), mesmo tom dos existentes.
- Nunca ler/editar `.env*`. Não commitar `.harness.json` nem `.claude-flow/`.
- Commit no fim de cada task, mensagem em inglês no imperativo, sem `Co-Authored-By`.
- Checks: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run format:check` (na raiz).
- `MAX_OPEN_TABS = 3`. Painel direito: `top: 16px; right: 16px; max-height: calc(100% - 32px)`.
  Bolha do usuário: `max-width: 80%`, alinhada à direita.

## Review Focus

1. Rewind com turno rodando: deve falhar com mensagem, sem tocar arquivos nem transcript (Task 4).
2. Rewind do primeiro turno: transcript vazio, `handoffContext = null`, `providerSessionId = null` (Task 4).
3. Rewind de turno sem checkpoint (projeto fora de git): só trunca e limpa memória, sem erro (Task 4).
4. Restauração de workspace com mais de 3 abas salvas: abre só 3, ativa uma delas (Task 3).
5. Texto `/nome` que não é skill nem comando conhecido: bolha mostra texto puro, sem tag (Task 8).

---

### Task 1: Painel direito flutuante

**Files:**
- Modify: `apps/desktop/src/renderer/session.css` (`.session-details`)
- Modify: `apps/desktop/src/renderer/styles.css` (`.app-body`, coluna do chat)

**Interfaces:** nenhuma.

- [ ] **Step 1:** `.app-body` ganha `position: relative`. `.session-details` vira `position: absolute; top: 16px; right: 16px; max-height: calc(100% - 32px); overflow-y: auto; border-radius` (use o raio dos tokens em `tokens.css`), sombra, fundo `var(--panel)`, borda `1px solid var(--border)`, sem `border-left` próprio. Altura natural (sem `height: 100%`).
- [ ] **Step 2:** Quando o painel está visível, a área do chat ganha `padding-right: 280px + 32px` para o texto não ficar coberto. Use uma classe no container (ex.: `main.has-details`) aplicada em `App.tsx` na mesma condição que renderiza `<SessionDetails>`.
- [ ] **Step 3:** Rode typecheck, lint, format:check. Esperado: sem erro.
- [ ] **Step 4:** Commit `Make session details panel float over the content`.

### Task 2: Sidebar colapsável com barra de ícones flutuante

**Files:**
- Modify: `apps/desktop/src/renderer/Sidebar.tsx`, `sidebar.css`, `App.tsx`
- Modify: o módulo de settings persistidas usado por `useSettings.ts` (campo novo opcional `sidebarCollapsed: boolean`, default `false`) e seu teste em `apps/desktop/test/settings-state.test.ts` ou `src/core/settings.test.ts` (onde os defaults são testados)

**Interfaces:**
- Produces: prop `collapsed: boolean` e `onToggleCollapsed: () => void` em `Sidebar`.

- [ ] **Step 1: Teste** — settings sem o campo carregam `sidebarCollapsed === false`; settings salvas com `true` preservam `true`.
- [ ] **Step 2:** Rode o teste. Esperado: FAIL.
- [ ] **Step 3:** Adicione o campo ao schema/defaults/validação de settings seguindo o padrão dos campos existentes.
- [ ] **Step 4:** Rode o teste. Esperado: PASS.
- [ ] **Step 5:** `Sidebar`: botão de recolher no topo (ícone de `icons.tsx`; crie `SidebarCollapseIcon`/`SidebarExpandIcon` lá se não existir). Colapsada, renderiza `<nav className="sidebar-rail">` flutuante (`position: absolute; top: 16px; left: 16px`, vertical, arredondada, sombra) com botões só de ícone e `data-tooltip`: Nova sessão (`onNavigate('new-session')`, `data-shortcut="new-session"`), os itens de `NAV_ITEMS` que correspondem a Workspace, Agentes paralelos, Comparar, Contas e providers, e Expandir. Item ativo destacado. Inbox e lista de projetos não aparecem colapsada.
- [ ] **Step 6:** `App.tsx` lê/grava `sidebarCollapsed` via `useSettings`. Quando colapsada, o conteúdo principal ganha `padding-left` para não ficar sob a barra.
- [ ] **Step 7:** Checks completos. Commit `Add collapsible sidebar with floating icon rail`.

### Task 3: Barra de abas com limite de 3

**Files:**
- Modify: `apps/desktop/src/renderer/tabs.ts`, `workspace.ts`, `App.tsx`
- Create: `apps/desktop/src/renderer/TabBar.tsx`, estilos em `session.css`
- Test: `apps/desktop/test/tabs.test.ts`, `apps/desktop/test/workspace.test.ts`

**Interfaces:**
- Produces: `export const MAX_OPEN_TABS = 3;` e `export function canOpenTab(state: TabsState, sessionId: string): boolean` em `tabs.ts` (true se a aba já existe ou se `tabs.length < MAX_OPEN_TABS`).
- `tabsReducer` com `open` de aba nova quando cheio retorna o `state` inalterado.

- [ ] **Step 1: Testes** em `tabs.test.ts`:
  - `canOpenTab` com 3 abas e id novo → `false`; com id existente → `true`; com 2 abas → `true`.
  - `open` de 4ª aba → state idêntico (`toBe(state)`).
  - `open` de aba existente com 3 abas → ativa.
  Em `workspace.test.ts`: `restoreTabs` com 5 abas salvas devolve 3, e `active` aponta para uma das 3 (a salva, se estiver entre elas; senão a primeira).
- [ ] **Step 2:** Rode. Esperado: FAIL.
- [ ] **Step 3:** Implemente em `tabs.ts` e `workspace.ts`.
- [ ] **Step 4:** Rode. Esperado: PASS.
- [ ] **Step 5:** `TabBar.tsx`: props `{ tabs: Tab[]; active: string | null; statusOf: (sessionId: string) => SessionStatus | undefined; onActivate(sessionId: string): void; onClose(tab: Tab): void }`. Cada aba: `ProviderBadge`/ícone do provider, título truncado, indicador de rodando, botão fechar (`requestCloseTab` existente). `role="tablist"`/`role="tab"`, `aria-selected`. Renderize acima do `SessionHeader` em `App.tsx` quando `chatTabs.length > 0`.
- [ ] **Step 6:** Em `App.tsx`, todo caminho que despacha `open` (abrir sessão da sidebar, inbox, nova sessão, fork) checa `canOpenTab` antes; se `false`, mostra aviso pelo mecanismo existente (`useWarning`) com o texto `Limite de 3 abas. Feche uma aba.` e não navega. Ao criar sessão nova com 3 abas abertas, faça a checagem antes de criar a sessão.
- [ ] **Step 7:** Checks completos. Commit `Add session tab bar limited to three open tabs`.

### Task 4: Handler `rewindSession` no main

**Files:**
- Modify: `src/core/handoff.ts` (função pura nova), `src/core/handoff.test.ts`
- Modify: `apps/desktop/src/main/handlers.ts`, `validation.ts`, `ipc.ts`
- Modify: `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/test/handlers.test.ts`, `validation.test.ts`, `preload.test.ts`, `ipc.test.ts` (seguir padrão de `forkSession`/`restoreCheckpoint`)

**Interfaces:**
- Produces (core): `export function truncateTranscriptAtTurn(events: readonly ChatEvent[], turnIndex: number): { kept: ChatEvent[]; removedUserText: string; checkpointRef: string | null } | null` — `null` se `turnIndex` não existir. `kept` termina antes do `checkpoint` imediatamente anterior ao `user` do turno (ou antes do `user`, se não houver checkpoint).
- Produces (IPC): `rewindSession(input: { sessionId: string; turnIndex: number }): Promise<Result<{ text: string }>>`, canal `'inova:rewindSession'`.

- [ ] **Step 1: Testes core** (`handoff.test.ts`):
  - 2 turnos com checkpoints; turno 1 → `kept` = eventos até antes do 2º checkpoint, `removedUserText` = texto do 2º user, `checkpointRef` = ref do 2º checkpoint.
  - turno 0 → `kept` = `[]` (nenhum evento antes do 1º checkpoint/user).
  - turno sem checkpoint anterior → `checkpointRef === null`, `kept` termina antes do `user`.
  - `turnIndex` 5 com 2 turnos → `null`.
- [ ] **Step 2:** Rode. FAIL. **Step 3:** Implemente. **Step 4:** PASS.
- [ ] **Step 5: Testes handler** (`handlers.test.ts`, com os fakes já usados nos testes de `forkSession`/`restoreCheckpoint`):
  - turno rodando (`chat.isRunning` → true) → `ok: false`, transcript e arquivos intactos.
  - rewind do turno 1 de 2 → `restoreCheckpoint` chamado com o ref do turno; transcript regravado com `kept`; sessão com `providerSessionId: null` e `handoffContext` não vazio; resultado `{ text }`.
  - rewind do turno 0 → `handoffContext: null`.
  - sem checkpoint → `restoreCheckpoint` não chamado; resto igual.
  - `turnIndex` inválido → `ok: false`.
- [ ] **Step 6:** Rode. FAIL.
- [ ] **Step 7:** Implemente `parseRewindSession` em `validation.ts` (`sessionId` string não vazia, `turnIndex` inteiro ≥ 0), handler dentro de `serialized`, usando `readTranscriptEvents`, `restoreCheckpoint({ repoPath: effectiveCwd(...), ref, preserveFiles: [] })` (confirme a assinatura de `preserveFiles`), `writeTranscriptEvents`, `buildHandoffContext({ events: kept, gitSummary, fromProvider, toProvider })` com provider da conta da sessão, `updateSession(...)`, `invalidateProjectFiles`. Registre canal, preload e tipo em `api.ts`.
- [ ] **Step 8:** Rode. PASS. Checks completos. Commit `Add rewindSession handler that restores files and resets agent memory`.

### Task 5: Mensagem do usuário — layout 80% e linha de metadados com retroceder

**Files:**
- Modify: `apps/desktop/src/renderer/ChatView.tsx` (`Message`, caso `'user'`), `chat.css`, `App.tsx`
- Modify: `apps/desktop/src/renderer/chat-reducer.ts` (guardar `at` no item `user`), `apps/desktop/test/chat-reducer.test.ts`
- Create (se não houver equivalente em `relative-time.ts`): `formatMessageTime(iso: string): string` → `HH:MM` local

**Interfaces:**
- Consumes: `window.inova.rewindSession` (Task 4).
- Produces: `ChatItem` `user` passa a ser `{ type: 'user'; id: string; text: string; at: string | null }`. Prop nova em `ChatView`: `onRewindTurn?: (turnIndex: number) => void`. `ChatView` expõe via ref (mesmo handle de `activeChatRef`) `setComposerText(text: string): void`.

- [ ] **Step 1: Teste** reducer: evento `user` com `at` produz item com o mesmo `at`. Teste de `formatMessageTime('2026-11-13T14:30:00')` → `'14:30'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implemente. **Step 4:** PASS.
- [ ] **Step 5:** UI: `.chat-row-user` com `align-items: flex-end`; bolha `max-width: 80%`. Remova o rótulo "Você". Abaixo da bolha, `.chat-meta` alinhada à direita: hora · copiar (`navigator.clipboard.writeText(item.text)`) · retroceder (ícone de undo/rotação anti-horária, tooltip `Retroceder: desfaz este turno e os arquivos editados`, desabilitado com `busy`) · bifurcar (ícone `GitForkIcon`, tooltip existente). Botões só ícone, discretos; ficam mais visíveis no hover da linha.
- [ ] **Step 6:** `App.tsx`: `onRewindTurn` abre `ConfirmModal` (título `Retroceder até esta mensagem?`, texto `Os turnos seguintes e os arquivos editados por eles serão desfeitos.`). Ao confirmar: chama `rewindSession`; em sucesso recarrega o chat da aba (mesma função usada no load do workspace) e chama `setComposerText(text)` da aba; em erro, `useWarning`.
- [ ] **Step 7:** Checks completos. Commit `Show user messages right-aligned with time, copy and rewind actions`.

### Task 6: Mensagem do agente — copiar, reações, regerar

**Files:**
- Modify: `src/core/chat-types.ts` (evento novo), `apps/desktop/src/renderer/chat-reducer.ts`, `turn-groups.ts` se o agrupamento decidir onde fica o rodapé, `ChatView.tsx`, `chat.css`, `App.tsx`
- Modify: `apps/desktop/src/main/handlers.ts` + IPC (`recordFeedback`)
- Test: `apps/desktop/test/chat-reducer.test.ts`, `handlers.test.ts`, `validation.test.ts`

**Interfaces:**
- Produces: `ChatEvent` ganha `| { kind: 'feedback'; turnIndex: number; value: 'up' | 'down' | null }`. Estado do reducer ganha `feedback: Record<number, 'up' | 'down'>`. IPC `recordFeedback(input: { sessionId: string; turnIndex: number; value: 'up' | 'down' | null }): Promise<Result<null>>` — anexa o evento ao transcript (não emite nada ao provider). Prop nova em `ChatView`: `onRegenerate?: () => void`, `onFeedback?: (input: { turnIndex: number; value: 'up' | 'down' | null }) => void`.

- [ ] **Step 1: Testes:** reducer aplica `feedback` (último evento por turno vence; `null` remove a chave); `load` de transcript com feedback reconstrói o mapa. Handler grava o evento; validação rejeita `value` fora de `up|down|null`.
- [ ] **Step 2:** FAIL. **Step 3:** Implemente. **Step 4:** PASS.
- [ ] **Step 5:** UI: após o último bloco de texto do assistente de cada turno concluído (não durante streaming), `.chat-meta` à esquerda: hora (do evento `done`/último texto; se não houver, omita) · copiar (texto concatenado do assistente no turno) · 👍 · 👎 (toggle; clicar no ativo envia `null`) · regerar (só no último turno, desabilitado com `busy`) · rótulo do modelo (`context.model`, se houver). Ícones de `icons.tsx` (crie `ThumbUpIcon`, `ThumbDownIcon`, `CopyIcon`, `RetryIcon` se faltarem).
- [ ] **Step 6:** `App.tsx`: `onRegenerate` = `rewindSession` do último turno (sem confirmação extra) → recarrega chat → `sendMessage(sessionId, text)` com o texto devolvido.
- [ ] **Step 7:** Checks completos. Commit `Add copy, feedback and regenerate actions to agent messages`.

### Task 7: Catálogo de comandos nativos por provider

**Files:**
- Create: `src/core/slash-commands.ts`, `src/core/slash-commands.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SlashCommandAction = 'passthrough' | 'clear' | 'model-picker';
  export interface NativeSlashCommand { name: string; description: string; action: SlashCommandAction }
  export function nativeSlashCommands(provider: ProviderId): readonly NativeSlashCommand[];
  ```
  Catálogo exatamente igual à tabela "Catálogo inicial" do spec, descrições em pt-BR curtas.

- [ ] **Step 1: Testes:** `gemini` não contém `clear`; `claude` contém `compact` (`passthrough`) e `clear` (`clear`); `codex` tem `new` com `action: 'clear'`; todo provider de `ProviderId` retorna lista com pelo menos `model`/`models` (`model-picker`); nomes sem `/` e únicos por provider.
- [ ] **Step 2:** FAIL. **Step 3:** Implemente. **Step 4:** PASS.
- [ ] **Step 5:** Checks. Commit `Add native slash command catalog per provider`.

### Task 8: Popup `/` com comandos nativos, ação `clear` e skills como tag

**Files:**
- Modify: `apps/desktop/src/renderer/composer-trigger.ts`, `ComposerPopup.tsx`, `ChatView.tsx`, `RichComposer.tsx` (chip), `App.tsx`, `chat.css`
- Modify: `apps/desktop/src/main/handlers.ts` (`sendMessage`: expansão de skill para não-claude; handler `clearSession`) + IPC
- Test: `apps/desktop/test/composer-trigger.test.ts`, `handlers.test.ts`

**Interfaces:**
- Consumes: `nativeSlashCommands` (Task 7), `truncateTranscriptAtTurn` não é usado aqui.
- Produces:
  - `export type SlashSuggestion = { kind: 'native'; command: NativeSlashCommand } | { kind: 'project'; command: ProjectCommandView }` e `filterSlashSuggestions(input: { native: readonly NativeSlashCommand[]; project: readonly ProjectCommandView[]; query: string }): SlashSuggestion[]` (nativos primeiro).
  - `parseLeadingSlashTag(input: { text: string; known: ReadonlySet<string> }): { name: string; rest: string } | null` — casa `/nome` no início do texto só se `nome` estiver em `known`.
  - IPC `clearSession(input: { sessionId: string }): Promise<Result<null>>` — falha se rodando; transcript vazio; `providerSessionId: null`; `handoffContext: null`. Não mexe em arquivos.
- Mudança de comportamento: escolher skill/comando de projeto insere chip `/nome ` em vez do corpo expandido (`applyCommandSuggestion` passa a inserir `/nome `). No main, `sendMessage`: se a conta da sessão não é `claude` e o prompt começa com `/nome` de um comando de projeto, expande com `expandCommandPrompt(body, rest)` antes de lançar o CLI; o evento `user` grava o texto original.

- [ ] **Step 1: Testes:**
  - `filterSlashSuggestions` com query `cl` para claude → primeiro item `native` `clear`.
  - `applyCommandSuggestion` → texto `/review ` e cursor no fim.
  - `parseLeadingSlashTag('/review agora', known={'review'})` → `{ name: 'review', rest: 'agora' }`; `'/xyz oi'` com `known` sem `xyz` → `null`; `'oi /review'` → `null`.
  - handler: `sendMessage` em sessão codex com `/minha-skill arg` lança CLI com corpo expandido e grava evento `user` com `/minha-skill arg`; em sessão claude lança com `/minha-skill arg` literal.
  - handler `clearSession`: rodando → `ok: false`; senão transcript vazio e sessão resetada.
- [ ] **Step 2:** FAIL. **Step 3:** Implemente. **Step 4:** PASS.
- [ ] **Step 5:** UI: popup mostra grupos `Comandos do <provider>` e `Comandos e skills do projeto`. Escolher nativo:
  - `passthrough` → insere chip `/nome ` no composer;
  - `clear` → `ConfirmModal` (`Limpar a conversa?` / `O histórico e a memória do agente nesta sessão serão apagados. Os arquivos não mudam.`) → `clearSession` → recarrega chat; limpa o texto do composer;
  - `model-picker` → abre `ModelEffortPicker` existente; limpa o `/` do composer.
  Chip no composer e tag na bolha usam o estilo de `chat-file-tag` com ícone de comando. A bolha usa `parseLeadingSlashTag` com `known` = nomes nativos do provider + comandos do projeto.
- [ ] **Step 6:** Checks completos. Commit `Show provider slash commands and render skills as tags`.

### Task 9: Verificação final

- [ ] **Step 1:** Rode na raiz `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run format:check`. Esperado: tudo verde. Cole o output resumido.
- [ ] **Step 2:** Se houver item novo de changelog no padrão do repo (`CHANGELOG.md`, seção não lançada), adicione entradas curtas em pt-BR para as 7 features. Commit `Add changelog entries for chat UI improvements`.
