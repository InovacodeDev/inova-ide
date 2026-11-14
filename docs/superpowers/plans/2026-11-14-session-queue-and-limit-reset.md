# Fila por sessão e verificação de reset do limite — design + plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** (1) Ao enviar com a conta marcada como esgotada, checar se o limite já resetou; se sim, sincronizar o uso e enviar; se não, mostrar o alerta de troca de provedor com o horário de reset. (2) Mensagens enviadas com a sessão rodando entram numa fila por sessão, visível, enviada uma por vez após cada output final bem-sucedido.

**Architecture:** Estado de esgotamento e fila vivem no main (`apps/desktop/src/main/handlers.ts`, `turn-queue.ts`). Renderer só envia, mostra e cancela. Lógica nova em funções puras testáveis.

**Tech Stack:** TypeScript strict, Electron, React, Vitest, pnpm.

## Global Constraints

- pnpm; nenhuma dependência nova. Sem `any`, sem `@ts-*`. Funções com mais de 3 parâmetros recebem objeto.
- Sem comentários exceto `REGEX:`, `ALGORITHM:`, `NOTE:`. Sem código comentado/TODO.
- Mudanças de IPC e tipos compartilhados são aditivas (`QueuedTurn.extraDirs?`, payload opcional).
- Copy em pt-BR.
- Checks: raiz `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run format:check` (falhas pré-existentes conhecidas: `.claude/settings.local.json`, `eslint.config.js`); desktop `pnpm --filter @inova/desktop typecheck` e `pnpm --filter @inova/desktop test`.
- Commits em inglês, imperativo, sem `Co-Authored-By`.

## Estado atual (recon)

- `exhaustedAccounts: Set<string>` e `streamUsage: Map<accountId, UsageSnapshot>` em memória (`handlers.ts` ~263/277). `isAccountExhausted` (~347) ignora `resetsAt`. Nada limpa o esgotamento quando o reset passa; `getUsage` (~1769) não grava em `streamUsage`.
- `sendMessage` (~1298) falha com `CONTA_ESGOTADA:` antes de lançar o CLI. Banner em `ChatView.tsx` (~1205) mostra troca de conta/handoff.
- `readUsage` (`src/core/usage.ts` ~489) consulta API para claude/codex/gemini; os outros devolvem `source: 'unavailable'`, `windows: []`.
- Fila existente é por conta (`turn-queue.ts`), só alimentada pelo botão "Enfileirar turno" do banner de conta ocupada; drena em `done` e `onAccountIdle`. `ChatView.submit` retorna sem fazer nada quando `running`. Renderer lista cards "Na fila — aguardando conta ficar livre" por aba, sem contagem.

## Review Focus

1. Conta sem API de uso (`unavailable`) com `resetsAt` nulo: não pode ficar bloqueada para sempre (Task 1).
2. Reset ainda no futuro: nenhuma chamada de rede extra a cada envio (Task 1).
3. Turno com erro ou cancelado: a fila da sessão pausa e não dispara a próxima (Task 2).
4. Drain por conta (`onAccountIdle`) não pode furar a pausa de uma sessão (Task 2).
5. `extraDirs` do item enfileirado chegam ao `runTurn` (Task 2).

---

### Task 1: Verificação de reset do limite no envio

**Files:** `src/core/usage.ts` (ou módulo novo `src/core/usage-limit.ts`) + teste; `apps/desktop/src/main/handlers.ts`; `apps/desktop/test/handlers.test.ts`; `apps/desktop/src/renderer/App.tsx`, `ChatView.tsx`.

**Interfaces:**
- Produces (core, puro): `export function exhaustionResetAt(windows: readonly UsageWindow[]): string | null` — maior `resetsAt` entre janelas com `usedPercent >= 100`; `null` se nenhuma tem `resetsAt`.
- Produces (core, puro): `export function exhaustionVerdict(input: { resetsAt: string | null; now: Date; fresh: UsageSnapshot | null }): 'exhausted' | 'available'` com as regras:
  - `fresh` com `source` de API (não `unavailable`): `exhausted` se alguma janela `usedPercent >= 100`, senão `available`.
  - Sem `fresh` útil: `available` se `resetsAt` não é nulo e `resetsAt <= now`; `available` se `resetsAt` é nulo (sem evidência — o CLI decide); senão `exhausted`.
- Main: `exhaustedAccounts` vira `Map<string, string | null>` (accountId → resetsAt). Ao marcar esgotado (evento de erro de rate limit ou `usage-limits` com janela ≥ 100), grave `exhaustionResetAt` do `streamUsage` da conta.
- Main: `sendMessage`, quando a conta está esgotada:
  - se `resetsAt` existe e está no futuro → `fail('CONTA_ESGOTADA: A conta atingiu o limite de uso. Libera às HH:MM. Troque de conta ou execute handoff.')` sem chamada de rede (HH:MM local; use o helper de hora existente se houver em core; senão formate no main);
  - senão → `readUsage({ account, deps: deps.usageDeps })` (erro de rede = `fresh: null`), aplique `exhaustionVerdict`; se `available`, grave o snapshot em `streamUsage` (quando veio de API), remova de `exhaustedAccounts`, siga com o envio e dispare o drain da conta; se `exhausted`, atualize o `resetsAt` e falhe com a mensagem acima (ou sem "Libera às" se não houver horário).
- Main: `getUsage` grava o snapshot de API em `streamUsage` e limpa o esgotamento quando nenhuma janela está ≥ 100.
- `isAccountExhausted` passa a considerar `resetsAt` vencido como não esgotado para o drain da fila (sem rede).
- Renderer: depois de um envio que antes estava esgotado (ou sempre que `sendMessage` tiver sucesso numa conta cujo uso no estado mostra janela ≥ 100), chame `loadUsage(label)` para sincronizar o rodapé. O banner de esgotado continua com troca de conta e handoff; mostre o texto da mensagem de erro (com "Libera às").

- [ ] Testes core das duas funções puras (casos: API <100 → available; API ≥100 → exhausted; unavailable + reset passado → available; unavailable + reset futuro → exhausted; sem fresh + resetsAt nulo → available; maior resetsAt escolhido).
- [ ] Testes de handler: (a) esgotada com reset futuro → falha com "Libera às", `readUsage` não chamado; (b) reset passado + API <100 → envio segue, esgotamento limpo; (c) reset passado + API ≥100 → falha; (d) `getUsage` com janelas <100 limpa esgotamento. Use os deps/fakes existentes de `usageDeps` nos testes.
- [ ] Implementar. Checks completos. Commit `Recheck usage limit reset before blocking a send`.

### Task 2: Fila por sessão, visível, enviada após cada output final

**Files:** `apps/desktop/src/main/turn-queue.ts` + `apps/desktop/test/turn-queue.test.ts`; `handlers.ts` + `handlers.test.ts`; `src/core/types.ts` (`QueuedTurn.extraDirs?: string[]`); `validation.ts`, `api.ts`, `preload/index.ts`, `ipc.ts` (+ testes de padrão); `App.tsx`, `ChatView.tsx`, `TabBar.tsx`, `chat.css`.

**Interfaces:**
- `TurnQueue` ganha `dequeueNextForSession(sessionId: string): QueuedTurn | undefined` e `dequeueNext(accountId, input?: { skipSessions: ReadonlySet<string> })` (ou equivalente) para o drain por conta pular sessões pausadas.
- `enqueueTurn` aceita `extraDirs?: string[]` e repassa ao `runTurn` no drain.
- Main mantém `pausedQueues: Set<sessionId>`.
  - `done` bem-sucedido (não erro, não cancelado) da sessão S: remove S de `pausedQueues`; se S tem item na fila e a conta está livre, roda `dequeueNextForSession(S)` (antes do drain por conta).
  - `done` com erro ou cancelado com fila não vazia: adiciona S a `pausedQueues`.
  - Drain por conta (`drainAccountQueue`, `onAccountIdle`) pula sessões pausadas.
  - IPC novo `resumeSessionQueue({ sessionId }): Result<null>`: remove a pausa e drena o primeiro item se a sessão/conta estiver livre.
  - Snapshot emitido ao renderer inclui as sessões pausadas: evento de fila passa a `{ queue: QueuedTurn[]; pausedSessionIds: string[] }` — se mudar o formato do evento quebrar o contrato, adicione um canal/evento novo `queuePausedEvent` em vez de alterar o existente.
- Renderer:
  - `ChatView.submit` com `running`: chama `onEnqueuePrompt({ prompt, extraDirs })`, limpa o editor e os anexos. O botão de enviar continua disponível ao lado do Parar enquanto roda (tooltip `Adicionar à fila`).
  - Acima do composer, quando a aba tem itens: faixa `N na fila` (singular `1 na fila`) e, se pausada, `Fila pausada` + botão `Retomar fila`.
  - Cards dos itens na fila: rótulo `Na fila` (ou `Na fila — aguardando conta ficar livre` quando a conta está ocupada por outra sessão), com Cancelar.
  - `TabBar`: badge com a contagem da fila da aba quando > 0.

- [ ] Testes `turn-queue`: `dequeueNextForSession` FIFO por sessão; drain por conta pula sessões em `skipSessions`.
- [ ] Testes handler: (a) dois itens enfileirados durante turno → após `done` ok, o 1º roda; após o próximo `done` ok, o 2º roda; (b) `done` com erro → nada roda, sessão pausada; `resumeSessionQueue` roda o próximo; (c) `onAccountIdle` não drena sessão pausada; (d) `extraDirs` do item chegam aos args do CLI (`--add-dir` no claude).
- [ ] Implementar. Checks completos. Commit `Queue messages per session and send them after each final output`.
