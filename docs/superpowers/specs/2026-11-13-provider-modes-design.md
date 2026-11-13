# Inova IDE: Configuração de Modos de Execução por Provedor

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Problema e objetivo

O launcher atual fixa flags de aprovação em `src/core/launch.ts` (como `acceptEdits` no Claude, `accept-edits --dangerously-skip-permissions` no Antigravity e `yolo` no Qwen). O usuário não consegue alternar entre modo somente planejamento (`plan`), modo cauteloso/manual, modo automático gerenciado e modo sem restrições (`bypass` / `turbo`) por sessão ou provedor.

O objetivo é adicionar um seletor de modo na barra do compositor (no padrão visual do `ModelEffortPicker`, inspirado nos menus "Modo" do Claude e "Local Permissions" do Antigravity), mantendo segurança explícita para execuções headless.

## Modelo de dados em `@inova/core`

### Tipos e catálogo (`src/core/modes.ts` e `src/core/types.ts`)

Adicionar o tipo `ExecutionMode` em `src/core/types.ts` com os modos suportados na IDE:

```typescript
export type ExecutionMode =
  | 'auto'
  | 'manual'
  | 'accept-edits'
  | 'plan'
  | 'bypass'
  | 'read-only';
```

Adicionar o campo opcional `mode?: ExecutionMode | null` em `Session` (`null` ou `undefined` significa usar o modo padrão do provedor) e `defaultModes?: Partial<Record<ProviderId, ExecutionMode>>` em `Store` para preferência global por provedor.

Cada provedor declara em `PROVIDER_MODES: Record<ProviderId, ProviderModeCatalog>` sua lista ordenada de opções:

- `defaultMode`: modo selecionado quando `Session.mode` é `null`.
- `options`: lista de `{ id: ExecutionMode; label: string; description: string; badge?: 'Recomendado' | 'Padrão'; headlessNote?: string }`.

### Mapeamento exato por provedor (`src/core/launch.ts`)

| Provedor | Opções exibidas na UI | Padrão atual | Flags geradas na CLI |
| --- | --- | --- | --- |
| `claude` | `auto` (`Automático` · Recomendado), `manual` (`Manual`), `accept-edits` (`Aceitar edições` · Padrão), `plan` (`Plano`), `bypass` (`Ignorar permissões`) | `accept-edits` | `auto` -> `--permission-mode auto`; `manual` -> `--permission-mode manual --permission-prompts none` (ou canal interativo quando ativo); `accept-edits` -> `--permission-mode acceptEdits`; `plan` -> `--permission-mode plan`; `bypass` -> `--permission-mode bypassPermissions --dangerously-skip-permissions` |
| `gemini` (`agy`) | `manual` (`Request Review`), `accept-edits` (`Default`), `auto` (`Auto`), `plan` (`Plano`), `bypass` (`Turbo` · Padrão) | `bypass` | `manual` -> `--mode accept-edits --sandbox`; `accept-edits` -> `--mode accept-edits`; `auto` -> `--mode auto`; `plan` -> `--mode plan`; `bypass` -> `--mode accept-edits --dangerously-skip-permissions` |
| `codex` | `read-only` (`Somente leitura`), `accept-edits` (`Workspace Write` · Padrão), `auto` (`Auto`), `bypass` (`Turbo / Bypass`) | `accept-edits` | `read-only` -> `--sandbox read-only`; `accept-edits` -> `--sandbox workspace-write`; `auto` -> `--sandbox workspace-write --approve-for-me`; `bypass` -> `--dangerously-bypass-approvals-and-sandbox` |
| `qwen` | `plan` (`Plano`), `manual` (`Default`), `accept-edits` (`Auto Edit`), `bypass` (`YOLO` · Padrão) | `bypass` | `--approval-mode <plan|default|auto-edit|yolo>` |
| `kimi` | `manual` (`Padrão`), `accept-edits` (`YOLO` · Padrão), `bypass` (`Auto`) | `accept-edits` | `manual` -> sem flag; `accept-edits` -> `--yolo`; `bypass` -> `--auto` |
| `grok` | `manual` (`Padrão`), `bypass` (`Sempre aprovar` · Padrão) | `bypass` | `manual` -> sem flag; `bypass` -> `--always-approve` |
| `opencode` | `manual` (`Padrão`), `auto` (`Auto` · Padrão) | `auto` | `manual` -> sem flag; `auto` -> `--auto` |
| `deepseek` | `read-only` (`Somente leitura`), `accept-edits` (`Workspace Write` · Padrão) | `accept-edits` | `read-only` -> `--mode read-only`; `accept-edits` -> `--mode workspace-write` |

Regra de comportamento headless:

- Modos `manual` (Claude, Qwen, Kimi, Grok, OpenCode) e `Request Review` (`agy`) executam sem TTY no chat da IDE. Enquanto o suporte de aprovação interativa por ferramenta não estiver ativo na sessão, a opção exibe nota discreta explicando que pedidos de aprovação são negados automaticamente (`--permission-prompts none` no Claude) ou exigem modo `accept-edits` / `auto` para editar arquivos.
- Ao escolher `bypass` pela primeira vez em um projeto fora de worktree isolado, a UI exibe badge de alerta visual (borda/ícone de escudo de atenção, como no ícone de Turbo da foto 2).

## Fluxo IPC e persistência (`@inova/desktop`)

1. `shared/api.ts`:
   - `SessionView` herda `mode?: ExecutionMode | null`.
   - `updateSession` aceita `mode?: ExecutionMode | null`.
   - Novos canais `getProviderModes` (opcionalmente síncrono via catálogo ou IPC `getPreferences` / `setDefaultProviderMode` para salvar o padrão global por provedor).
2. `main/validation.ts`:
   - `parseSessionUpdate` valida `mode` usando `isExecutionMode(mode)`.
   - `parseDefaultMode` valida `{ provider, mode }`.
3. `main/handlers.ts`:
   - `updateSession` verifica `isModeSupported(account.provider, mode)` antes de salvar; retorna `{ ok: false, message: 'Modo não suportado por este provedor.' }` se inválido.
   - `createSession` herda o modo padrão salvo em `store.defaultModes?.[account.provider] ?? null`.
   - `runTurn` resolve `effectiveMode = session.mode ?? store.defaultModes?.[account.provider] ?? PROVIDER_MODES[account.provider].defaultMode` e repassa para `buildChatTurn`.

## Interface do usuário (`ModePicker.tsx`)

1. Novo componente `apps/desktop/src/renderer/ModePicker.tsx` posicionado na `.chat-composer-bar` ao lado de `ModelEffortPicker`:
   - Gatilho compacto mostrando ícone Phosphor correspondente ao modo (`ShieldCheck`, `Eye`, `Lock`, `Pencil`, `ListChecks`, `Lightning`) + nome curto do modo ativo (ex.: `Aceitar edições`, `Turbo`, `Plano`).
   - Popover estilo menu vertical (fiel às capturas enviadas): título ("Modo" ou "Permissões locais"), lista de opções do provedor com ícone, título, badge (`Recomendado` / `Padrão`), descrição em 2 linhas, marca de seleção (`CheckIcon`) e atalho numérico (`1`..`5`) quando o popover está aberto.
   - Ação secundária no rodapé do popover: **"Definir como padrão para <Provedor>"**, persistindo em `store.defaultModes`.
2. Desabilita troca durante turno ativo (`disabled={readOnly || running}`) com a mesma regra do `ModelEffortPicker`.

## Plano de testes

- `src/core/modes.test.ts`: validação de `isModeSupported`, `PROVIDER_MODES` para todos os 8 provedores e fallbacks padrão.
- `src/core/launch.test.ts`: asserções exatas das flags geradas por `buildChatTurn` para cada modo de `claude`, `gemini`, `codex`, `qwen`, `kimi`, `grok`, `opencode` e `deepseek`.
- `apps/desktop/test/validation.test.ts` e `handlers.test.ts`: rejeição de modo não suportado pelo provedor, herança de modo padrão na criação de sessão e passagem do modo para `buildChatTurn`.
- `apps/desktop/test/mode-picker-state.test.ts`: helper puro de formatação, seleção numérica (`1`..`5`) e resolução de modo efetivo.
