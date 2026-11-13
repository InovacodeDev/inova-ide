# Inova IDE Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar todos os subprojetos do roadmap na branch `feat/ide-workflows`: autocomplete `@arquivo` e `/comando`, modos por provedor, worktrees/checkpoints/verificação pós-turno, caixa de entrada/fila/handoff/fork, comparação paralela e perfil unificado de MCPs e regras.

**Architecture:** Toda lógica pura e integração Git/FS/CLI reside em `src/core/` (`@inova/core`) testada com repositórios e diretórios temporários reais. O processo main do `@inova/desktop` expõe canais IPC tipados em `src/shared/api.ts`, validados em `src/main/validation.ts` e orquestrados em `src/main/handlers.ts`. O renderer React consome `window.inova` com estado puro testável em helpers dedicados.

**Tech Stack:** TypeScript strict, Node.js 24, Electron, electron-vite, React 19, Vitest, ESLint (`--max-warnings 0`), Prettier.

**Specs:**
- `docs/superpowers/specs/2026-11-13-ide-workflows-roadmap-and-provider-matrix.md`
- `docs/superpowers/specs/2026-11-13-composer-autocomplete-commands-design.md`
- `docs/superpowers/specs/2026-11-13-provider-modes-design.md`
- `docs/superpowers/specs/2026-11-13-git-worktrees-checkpoints-verification-design.md`
- `docs/superpowers/specs/2026-11-13-session-orchestration-inbox-design.md`
- `docs/superpowers/specs/2026-11-13-parallel-compare-unified-profile-design.md`

## Global Constraints

- TS strict, zero `any`, zero comentários fora de `REGEX:`/`ALGORITHM:`/`NOTE:`, funções com > 3 parâmetros recebem objeto único.
- Proibido tocar em `.env*` reais.
- Todos os textos de UI em português (ASD-STE100).
- React: nunca chamar `setState` síncrono dentro de `useEffect` (usar `queueMicrotask` quando necessário).
- TDD obrigatório: escrever teste que falha primeiro, confirmar falha, implementar mínimo, confirmar verde.
- Checks antes de concluir cada bloco: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @inova/desktop typecheck && pnpm --filter @inova/desktop test`.

---

### Bloco 1: Compositor `@arquivo` e `/comando`
- `src/core/files.ts` + `src/core/files.test.ts`: `listProjectFiles`, `rankProjectFiles`.
- `src/core/commands.ts` + `src/core/commands.test.ts`: `listProjectCommands`, `expandCommandPrompt`.
- `apps/desktop`: canais `searchFiles` e `listCommands` (`shared/api.ts`, `preload/index.ts`, `main/ipc.ts`, `main/validation.ts`, `main/handlers.ts` com cache TTL 5s + invalidação pós-turno).
- Renderer: `composer-trigger.ts`, `ComposerPopup.tsx`, `ChatView.tsx`, `App.tsx`, `chat.css`, `composer-trigger.test.ts`.

### Bloco 2: Modos por Provedor
- `src/core/types.ts`, `src/core/modes.ts` + `src/core/modes.test.ts`: `ExecutionMode`, `PROVIDER_MODES`, `isExecutionMode`, `isModeSupported`, `resolveExecutionMode`.
- `src/core/store.ts`, `src/core/sessions.ts`, `src/core/launch.ts` + testes: persistência de `Session.mode` e `Store.defaultModes`, mapeamento das flags de CLI por provedor.
- `apps/desktop`: validação de `mode`, IPC `getDefaultModes` / `setDefaultMode`, `mode-picker-state.ts`, `ModePicker.tsx`, integração em `ChatView.tsx` e `App.tsx`.

### Bloco 3: Worktrees, Checkpoints Git e Verificação Pós-Turno
- `src/core/git-worktree.ts` + `src/core/git-worktree.test.ts`: criação, status/diff, aplicação no repo principal e remoção segura.
- `src/core/git-checkpoints.ts` + `src/core/git-checkpoints.test.ts`: snapshot via `GIT_INDEX_FILE` temporário e `refs/inova/checkpoints/...`, exclusão de arquivos > 10 MiB, restauração e limpeza.
- `src/core/verification.ts` + `src/core/verification.test.ts`: `detectProjectChecks`, `runVerificationChecks` com timeout e captura de saída.
- `src/core/chat-types.ts`, `src/core/types.ts`, `src/core/store.ts`, `src/core/sessions.ts`, `src/core/projects.ts`.
- `apps/desktop`: `handlers.ts` (effectiveCwd, checkpoint automático antes do turno, verificação após `done`, canais `createSession` com worktree, `applyWorktree`, `restoreCheckpoint`, `updateProjectVerification`, `runVerification`), `chat-reducer.ts`, `ChatView.tsx`, `SessionHeader.tsx`, `SessionDetails.tsx`, `NewSessionView.tsx`, `App.tsx`.

### Bloco 4: Caixa de Entrada, Fila/Troca de Conta, Handoff e Fork
- `src/core/handoff.ts` + `src/core/handoff.test.ts`: `buildHandoffContext`.
- `apps/desktop/src/main/turn-queue.ts` + `apps/desktop/test/turn-queue.test.ts`: fila FIFO por conta, detecção de conta ocupada/esgotada, troca explícita de conta.
- `apps/desktop/src/main/handlers.ts` + IPC/preload/validation: `forkSession`, `handoffSession`, `switchSessionAccount`, `enqueueTurn`, `cancelQueuedTurn`, `listInbox`, `markInboxRead`, `clearReadInbox`.
- Renderer: `inbox-state.ts`, `InboxView.tsx` (integrada na `Sidebar.tsx` com badge e salto direto para a sessão), botão **"Bifurcar daqui"** por turno no `ChatView.tsx`, diálogo/fluxo de Handoff e Fila em `SessionHeader.tsx` / `ChatView.tsx` / `App.tsx`.

### Bloco 5: Execução Paralela Comparativa e Perfil Unificado de MCPs/Regras
- `src/core/git-compare.ts` + `src/core/git-compare.test.ts`: diff estruturado de dois worktrees contra `baseCommit` e aplicação do vencedor.
- `src/core/profile-sync.ts` + `src/core/profile-sync.test.ts`: leitura de `.mcp.json` + `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, adaptadores para Claude (`claude mcp add-json` / `.claude.json`), Codex (`config.toml`), Gemini (`agy mcp add`), OpenCode (`opencode.json`), Qwen (`.qwen/settings.json`), preview com mascaramento de segredos e backup antes de aplicar.
- `apps/desktop`: IPC `startComparison`, `getComparisonDiff`, `resolveComparison`, `previewProfileSync`, `applyProfileSync`; componentes `CompareView.tsx` e `ProfileSyncModal.tsx` integrados em `App.tsx`, `Sidebar.tsx` e `SessionDetails.tsx`.

### Bloco 6: Loop de Verificação Final (`review-loop`)
- Rodar revisão adversarial completa contra cada item do contrato, validar `typecheck`, `lint`, `test`, `electron-vite build` e `prettier --check`, corrigir eventuais achados com TDD e re-validar tudo ao final.
