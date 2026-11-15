# Capacidades por conta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engrenagem em cada conta da tela "Contas e providers" que lista skills, MCP, conectores e plugins da conta, com chave liga/desliga por item e custo em tokens no Claude.

**Architecture:** Núcleo em `src/core/capabilities/` com um adaptador por provider (`list`, `launchArgs`, `setEnabled`). Itens `launch` ficam em `Account.disabledCapabilities` no `store.json` e viram flags em cada turno. Itens `account-file`/`global-file` gravam no arquivo nativo (com backup e fila) ou rodam o `enable/disable` do próprio CLI. O desktop expõe dois handlers IPC e um modal.

**Tech Stack:** TypeScript strict, Node `fs/promises`, Electron IPC, React (function components), Vitest. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-14-account-capabilities-design.md` (leia a seção do provider da sua tarefa, "Modos de aplicação", "Edição de arquivos", "Decisões fechadas" e "Resultado dos spikes").

## Global Constraints

- pnpm apenas. Sem dependência nova (nada de parser TOML/YAML).
- Sem `any`, sem `@ts-ignore`; `unknown` + type guard.
- Sem comentários, exceto `REGEX:`, `ALGORITHM:` ou `NOTE:`.
- Nunca ler `.env*`. Nunca exibir valores de `env`, `headers`, tokens de MCP em UI, log ou erro.
- Toda gravação em arquivo: backup em `<dataRoot>/backups/capabilities/<timestamp>/` + escrita atômica (temp + `rename`).
- Comandos de CLI: env de `isolatedEnv(account, baseEnv)`, timeout de 30 000 ms.
- Mudança aditiva: sem itens desligados, os args de `buildChatTurn` ficam idênticos aos atuais e os testes atuais de `launch.ts` passam sem alteração.
- Textos da UI em português, exatamente como no spec quando o spec fixa o texto.
- Checks por tarefa: `pnpm run typecheck` (raiz e `apps/desktop`), `pnpm run lint`, `pnpm exec vitest run <arquivos da tarefa>`, `pnpm exec prettier --check <arquivos>`.

## Review Focus

1. Conta com arquivo de configuração ausente ou JSON/TOML inválido → `list` devolve itens vazios ou erro por categoria; nunca derruba o modal nem grava por cima.
2. Nome de MCP com espaço, ponto ou aspas (`claude.ai Gmail`, `my.server`) → id cru salvo, normalizado só no `launchArgs`; TOML editado com a chave entre aspas quando necessário.
3. CLI ausente ou que expira o timeout → categoria com `error`, demais abas aparecem.
4. Item desligado que foi desinstalado depois → não aparece no modal e não gera flag que quebre o CLI.
5. Duas chaves clicadas rápido no mesmo arquivo → a fila serializa; o estado final reflete os dois cliques.

Cada linha tem um teste na tarefa dona (marcado `[RF-n]`).

---

### Task 1: Tipos e campo no store

**Files:**
- Create: `src/core/capabilities/types.ts`
- Modify: `src/core/types.ts` (interface `Account`), `src/core/store.ts` (`isAccount`)
- Test: `src/core/store.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type CapabilityKind = 'skill' | 'mcp' | 'connector' | 'plugin';
  export type CapabilityApplyMode = 'launch' | 'account-file' | 'global-file' | 'unsupported';
  export interface CapabilityRef { kind: CapabilityKind; id: string }
  export interface CapabilityItem {
    kind: CapabilityKind; id: string; name: string; description: string | null;
    source: 'user' | 'plugin' | 'connector' | 'bundled';
    enabled: boolean; applyMode: CapabilityApplyMode; unsupportedReason: string | null;
    tokens: number | null; group: string | null;
  }
  export interface CapabilityCostSummary { loadedTokens: number | null; instructionTokens: number | null; deferredTokens: number | null }
  export interface CapabilityCategoryResult { kind: CapabilityKind; items: CapabilityItem[]; error: string | null }
  export interface CapabilityListing { categories: CapabilityCategoryResult[]; cost: CapabilityCostSummary | null }
  export interface CapabilityContext { account: Account; runner: CommandRunner; env: NodeJS.ProcessEnv; projectPath: string | null; backupRoot: string }
  export interface SetEnabledInput { ctx: CapabilityContext; ref: CapabilityRef; enabled: boolean }
  export interface CapabilityAdapter {
    list(ctx: CapabilityContext): Promise<CapabilityListing>;
    launchArgs(disabled: readonly CapabilityRef[]): string[];
    setEnabled(input: SetEnabledInput): Promise<void>;
  }
  export function isCapabilityRef(value: unknown): value is CapabilityRef;
  ```
- `Account` ganha `disabledCapabilities?: CapabilityRef[]`.

- [ ] **Step 1: Teste** em `store.test.ts`: `loadStore` aceita conta com `disabledCapabilities: [{ kind: 'mcp', id: 'claude.ai Gmail' }]` e preserva o array; rejeita (`StoreCorruptError`) conta com `disabledCapabilities: [{ kind: 'tool', id: 'x' }]`; aceita conta sem o campo.
- [ ] **Step 2:** Rode `pnpm exec vitest run src/core/store.test.ts` → FAIL.
- [ ] **Step 3:** Implemente os tipos, `isCapabilityRef` (kind no conjunto, `id` string não vazia ≤ 512 chars) e a checagem opcional em `isAccount`.
- [ ] **Step 4:** Rode de novo → PASS. Rode `pnpm run typecheck`.
- [ ] **Step 5:** Commit `Add capability types and account field`.

### Task 2: Utilitários de edição de arquivo

**Files:**
- Create: `src/core/capabilities/file-edit.ts`
- Test: `src/core/capabilities/file-edit.test.ts`

**Interfaces:**
- Consumes: padrões `writeAtomic`/backup de `src/core/profile-sync.ts` (extraia para cá se for reutilizar; não duplique).
- Produces:
  ```typescript
  export class CapabilityFileError extends Error { constructor(path: string, reason: string) }
  export async function backupFile(input: { file: string; backupRoot: string }): Promise<void>;
  export async function updateJsonFile(input: { file: string; backupRoot: string; update: (root: Record<string, unknown>) => Record<string, unknown> }): Promise<void>;
  export function setTomlTableKey(input: { toml: string; table: string; key: string; value: boolean }): string;
  export function setTomlArrayMembership(input: { toml: string; table: string; key: string; member: string; present: boolean }): string;
  export function setTomlSkillConfig(input: { toml: string; name: string; enabled: boolean }): string;
  export function tomlTableHeader(segments: readonly string[]): string;
  export async function updateTomlFile(input: { file: string; backupRoot: string; update: (toml: string) => string }): Promise<void>;
  export function serialize<T>(key: string, task: () => Promise<T>): Promise<T>;
  ```
  `table` é o caminho com segmentos já citados por `tomlTableHeader` (ex.: `tomlTableHeader(['mcp_servers', 'my.server'])` → `mcp_servers."my.server"`).

- [ ] **Step 1: Testes**:
  - `setTomlTableKey`: tabela existe com `enabled = true` → troca para `false`; tabela existe sem `enabled` → insere `enabled = false` na linha seguinte ao header; tabela ausente → anexa `\n[<table>]\nenabled = false\n`; outras tabelas e comentários ficam byte a byte iguais.
  - `[RF-2]` `tomlTableHeader(['mcp_servers','my.server'])` = `mcp_servers."my.server"`; `['plugins','github@openai-curated-remote']` = `plugins."github@openai-curated-remote"`; segmento `[A-Za-z0-9_-]+` fica sem aspas.
  - Forma desconhecida (tabela alvo definida inline, ex.: `mcp_servers = { x = {...} }`) → lança `CapabilityFileError`.
  - `setTomlSkillConfig`: adiciona bloco `[[skills.config]]` com `name`/`enabled = false`; ao reativar, remove só o bloco daquele `name`.
  - `setTomlArrayMembership` para `[skills] disabled = ["a"]`: adiciona `"b"`, remove `"a"`, cria a tabela se ausente.
  - `[RF-1]` `updateJsonFile` com JSON inválido → `CapabilityFileError` e arquivo original intacto; arquivo ausente → cria `{}` antes de `update`.
  - `updateJsonFile` grava backup em `backupRoot` antes de alterar (verifique o arquivo copiado).
  - `[RF-5]` `serialize('k', …)` duas vezes em paralelo, cada uma lendo-incrementando-gravando um contador num arquivo temporário → valor final 2.
- [ ] **Step 2:** Rode `pnpm exec vitest run src/core/capabilities/file-edit.test.ts` → FAIL.
- [ ] **Step 3:** Implemente. TOML por linhas (mesmo estilo de `stripTomlMcpSections`). JSON com `JSON.stringify(root, null, 2) + '\n'`. Fila = `Map<string, Promise<unknown>>` encadeada.
- [ ] **Step 4:** Rode → PASS.
- [ ] **Step 5:** Commit `Add capability file editing helpers`.

### Task 3: Adaptador Claude

**Files:**
- Create: `src/core/capabilities/claude.ts`, `src/core/fixtures/capabilities/claude-context.md`, `src/core/fixtures/capabilities/claude-mcp-list.txt`, `src/core/fixtures/capabilities/claude-plugin-list.json`
- Test: `src/core/capabilities/claude.test.ts`

**Interfaces:**
- Consumes: Task 1 tipos; `parseClaudeContextOutput`, `parseContextReport` de `src/core/context-report.ts`.
- Produces: `export const claudeCapabilities: CapabilityAdapter;` e `export function normalizeMcpName(name: string): string;`

Listagem (spec, seção Claude): rode em paralelo com `ctx.runner` e timeout 30 000 ms:
`claude -p --output-format json --no-session-persistence -- /context` (cwd = `ctx.projectPath ?? ctx.account.homeDir`), `claude mcp list`, `claude plugin list --json`. Fixtures: gere a partir da saída real desta máquina, trocando nomes que identifiquem o usuário por genéricos e removendo qualquer URL com query string.

- [ ] **Step 1: Testes** (runner falso que devolve as fixtures):
  - Conectores: cada linha `claude.ai <Nome>` vira `{ kind: 'connector', id: 'claude.ai Gmail', source: 'connector', applyMode: 'launch' }`; `tokens` = soma da tabela "MCP Tools" para o server `claude_ai_Gmail`.
  - MCP não-claude.ai (ex.: `graft`) vira `kind: 'mcp'` com `tokens` somados.
  - Skills: `Source` `Built-in`/`User` → `launch`; `Plugin (superpowers)` → `unsupported`, `unsupportedReason: 'Desligue o plugin superpowers'`, `group: 'superpowers'`.
  - Plugins: `{ id: 'superpowers@synced', enabled: true }` → `kind: 'plugin'`, `launch`.
  - `enabled` de item `launch` = não está em `ctx.account.disabledCapabilities`.
  - `cost` = `{ loadedTokens: 612, instructionTokens: 2100, deferredTokens: 78400 }` a partir da tabela de categorias da fixture.
  - `[RF-3]` runner devolve `{ notFound: true }` → todas as categorias com `error: 'claude não encontrado.'`; `/context` com exit ≠ 0 → skills com `error`, conectores ainda listados com `tokens: null`.
  - `normalizeMcpName('claude.ai Gmail')` = `'claude_ai_Gmail'`; dois nomes que colidem geram o mesmo valor (documenta a decisão 6).
  - `launchArgs([])` = `[]`.
  - `launchArgs` com Gmail + skill `dataviz` + plugin `superpowers@synced` → `['--settings', json]` onde `JSON.parse(json)` = `{ permissions: { deny: ['mcp__claude_ai_Gmail'] }, skillOverrides: { dataviz: 'off' }, enabledPlugins: { 'superpowers@synced': false } }`.
  - `launchArgs` com todos os conectores conhecidos desligados: não dá para saber "todos" só pelos refs → o adaptador recebe a regra assim: se `disabled` contém `{ kind: 'connector', id: '*' }`, emite `disableClaudeAiConnectors: true` e omite os deny de conectores. O handler (Task 9) grava esse ref quando o último conector é desligado e o remove quando um é religado.
  - `setEnabled` lança `Error('Claude usa só o modo launch.')`.
- [ ] **Step 2:** Rode → FAIL.
- [ ] **Step 3:** Implemente. Parse de `claude mcp list`: uma linha por servidor no formato `<nome>: <comando/url> - <status>`; capture `<nome>` até o primeiro `: ` (confira o formato real na fixture).
- [ ] **Step 4:** Rode → PASS.
- [ ] **Step 5:** Commit `Add Claude capability adapter`.

### Task 4: Adaptador Codex

**Files:**
- Create: `src/core/capabilities/codex.ts`, fixtures `codex-mcp-list.json`, `codex-plugin-list.json`, `codex-config.toml`
- Test: `src/core/capabilities/codex.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `export const codexCapabilities: CapabilityAdapter;`

Spec, seção Codex: MCP `launch` via `-c mcp_servers.<header>.enabled=false`; plugins `account-file` (`[plugins."<pluginId>"] enabled = false`); skills `account-file` (`[[skills.config]]`), lidas de `<realHome>/.agents/skills/*/SKILL.md` e `$CODEX_HOME/skills/*/SKILL.md` (nome = pasta; `description` do frontmatter). `realHome` = `ctx.env.HOME`.

- [ ] **Step 1: Testes**:
  - Listagem: MCP de `codex mcp list --json`; plugins só de `.installed[]` com `id = pluginId`, `enabled` lido do JSON; skills com `enabled = false` quando há `[[skills.config]]` com aquele `name` e `enabled = false` no `config.toml`.
  - `launchArgs([{ kind: 'mcp', id: 'my.server' }])` = `['-c', 'mcp_servers."my.server".enabled=false']`; refs de plugin/skill são ignorados.
  - `setEnabled` plugin → `config.toml` da conta ganha `[plugins."github@openai-curated-remote"]` com `enabled = false`, com backup.
  - `setEnabled` skill → bloco `[[skills.config]]`.
  - `[RF-1]` `config.toml` ausente → listagem funciona; `setEnabled` cria o arquivo.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Add Codex capability adapter`.

Nota de integração: os args de `-c` precisam entrar antes do prompt em `codexTurnArgs` (Task 7 cuida da posição).

### Task 5: Adaptadores agy e Qwen

**Files:**
- Create: `src/core/capabilities/gemini.ts`, `src/core/capabilities/qwen.ts`, fixtures `agy-mcp-list.txt`, `agy-plugin-list.json`, `qwen-settings.json`
- Test: `src/core/capabilities/gemini.test.ts`, `src/core/capabilities/qwen.test.ts`

**Interfaces:**
- Produces: `export const geminiCapabilities: CapabilityAdapter; export const qwenCapabilities: CapabilityAdapter;`

agy (spec, seção Gemini/Antigravity): `agy mcp list` (texto, colunas NAME TYPE STATUS), `agy plugin list --json`. `setEnabled` roda `agy mcp enable|disable <nome>` ou `agy plugin enable|disable <nome>` com o env da conta. Skills vêm das plugins, `unsupported`, `group` = plugin. Antes de implementar, confirme o formato real com `HOME=$(mktemp -d) agy mcp list` e `agy plugin list --json` (pasta temporária, nunca a conta real).

Qwen: lê `<HOME da conta>/.qwen/settings.json` (`mcpServers`, `mcp.excluded`, `skills.disabled`) e `<HOME da conta>/.qwen/extensions/*/qwen-extension.json` (`name`). Todos os itens são `account-file`: as flags do Qwen (`--allowed-mcp-server-names`, `-e`) são listas de permitidos e `launchArgs` não conhece a lista completa. MCP → `mcp.excluded`; skills → `skills.disabled` (ambos via `updateJsonFile`); extensões → `qwen extensions enable|disable <nome>`.

- [ ] **Step 1: Testes**:
  - agy: parse da tabela de `mcp list` (STATUS `disabled` → `enabled: false`); `setEnabled({ kind: 'mcp', id: 'rea' }, false)` chama runner com `['mcp', 'disable', 'rea']` e env com `HOME` da conta; exit ≠ 0 → lança `Error('Falha ao desligar rea.')`.
  - Qwen: `launchArgs(qualquer)` = `[]`.
  - Qwen `setEnabled` MCP → `mcp.excluded` ganha/perde o nome; skill → `skills.disabled`; extensão → runner `['extensions', 'disable', '<nome>']`.
  - `[RF-1]` `settings.json` inválido → categorias com `error`, sem gravação.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Add agy and Qwen capability adapters`.

### Task 6: Adaptadores OpenCode, Kimi, Grok e DeepSeek

**Files:**
- Create: `src/core/capabilities/opencode.ts`, `kimi.ts`, `grok.ts`, `deepseek.ts`, fixtures `opencode.json`, `kimi-mcp.json`, `grok-config.toml`
- Test: um `*.test.ts` por adaptador

**Interfaces:**
- Produces: `opencodeCapabilities`, `kimiCapabilities`, `grokCapabilities`, `deepseekCapabilities` (todos `CapabilityAdapter`, `launchArgs` → `[]`).

Spec, seções de cada provider. Caminhos: OpenCode `<realHome>/.config/opencode/opencode.json` (modo `global-file`); Kimi `$KIMI_CODE_HOME/mcp.json`; Grok `$GROK_HOME/config.toml`. DeepSeek: `list` devolve `{ categories: [], cost: null }`; `setEnabled` lança `Error('DeepSeek não expõe itens configuráveis.')`.

- [ ] **Step 1: Testes**:
  - OpenCode MCP `disabled: true` ↔ `enabled: false`; plugin `-<nome>` na lista `plugins`; skill via `permissions` `{ action: 'skill', resource: '<id>', effect: 'deny' }` (adiciona ao desligar, remove ao ligar). Todos com `applyMode: 'global-file'`.
  - Kimi MCP `enabled: false`; skills e plugins `unsupported` com motivo `Kimi não permite desligar skills uma a uma.` / `Kimi só desliga plugins dentro da sessão (/plugins disable).`.
  - Grok MCP `[mcp_servers.<n>] enabled = false`; skills `[skills] disabled`; plugins `[plugins] disabled`.
  - `[RF-1]` arquivo ausente → lista vazia sem erro; arquivo inválido → `error` na categoria.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Add OpenCode, Kimi, Grok and DeepSeek capability adapters`.

### Task 7: Registro e integração no lançamento

**Files:**
- Create: `src/core/capabilities/index.ts`
- Modify: `src/core/launch.ts` (`buildChatTurn`, `codexTurnArgs`, `claudeTurnArgs`), `src/project-commands.ts` (`runProject`), `apps/desktop/src/main/handlers.ts` (`getContextBreakdown`, ~linha 1989)
- Test: `src/core/launch.test.ts`, `src/project-commands.test.ts`

**Interfaces:**
- Consumes: adaptadores das Tasks 3–6.
- Produces:
  ```typescript
  export const capabilityAdapters: Record<ProviderId, CapabilityAdapter>;
  export function capabilityLaunchArgs(account: Account): string[];
  ```
  `TurnModelOptions` ganha `capabilityArgs?: readonly string[]`.

- [ ] **Step 1: Testes**:
  - Os testes atuais de `launch.test.ts` passam sem mudança.
  - Conta Claude com Gmail desligado: `buildChatTurn(...).args` contém `--settings` antes de `--` e do prompt.
  - Conta Codex com MCP desligado: `-c mcp_servers.x.enabled=false` aparece antes do prompt, também em `exec resume`.
  - `[RF-4]` `capabilityLaunchArgs` ignora refs inválidos sem lançar.
  - `runProject` passa os args da conta para o CLI interativo.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Apply disabled capabilities when launching sessions`.

### Task 8: Sincronização de perfil preserva o estado

**Files:**
- Modify: `src/core/profile-sync.ts` (`mergeMcpServersJson`, `formatCodexMcpToml`, fluxo `agy mcp add`)
- Test: `src/core/profile-sync.test.ts`

- [ ] **Step 1: Testes**:
  - `mergeMcpServersJson` com destino `{ mcpServers: { a: { command: 'x', enabled: false } } }` e origem `a` → resultado mantém `enabled: false`; mesmo para `disabled: true`.
  - `formatCodexMcpToml` mantém a linha `enabled = false` de uma tabela `[mcp_servers.a]` reescrita.
  - agy: depois de `agy mcp add` de um servidor que estava desligado, o fluxo roda `agy mcp disable <nome>` (runner falso registra a ordem).
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Preserve disabled MCP state during profile sync`.

### Task 9: Handlers, IPC e API

**Files:**
- Modify: `apps/desktop/src/shared/api.ts` (tipos re-exportados de `@inova/core/capabilities/types`, métodos, canais), `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/validation.ts`, `apps/desktop/src/main/handlers.ts`
- Test: `apps/desktop/test/handlers.test.ts`, `apps/desktop/test/validation.test.ts`, `apps/desktop/test/ipc.test.ts`, `apps/desktop/test/preload.test.ts`

**Interfaces:**
- Produces (renderer):
  ```typescript
  listCapabilities(input: { accountLabel: string }): Promise<Result<CapabilityListing>>;
  setCapabilityEnabled(input: { accountLabel: string; kind: CapabilityKind; id: string; enabled: boolean }): Promise<Result<CapabilityListing>>;
  ```
  Canais `inova:listCapabilities`, `inova:setCapabilityEnabled`.
- Validation: `parseCapabilityList(input): { accountLabel: string } | undefined`, `parseCapabilityToggle(input): {...} | undefined` (`id` 1–512 chars, `kind` no conjunto).

Comportamento (spec "Decisões fechadas" 4 e 7):
- `projectPath` = caminho do primeiro projeto da conta em `store.projects`, ou `null`.
- Cache em memória `Map<accountId, CapabilityListing>` com a última listagem bem-sucedida. `listCapabilities` sempre lista de novo e atualiza o cache. Uma categoria que voltar com `error` usa os itens do cache, mantendo o `error` para a UI mostrar o aviso. `setCapabilityEnabled` usa o cache para achar o `applyMode` do item; se o item não estiver no cache, lista antes.
- `setCapabilityEnabled`: busca o item na última listagem da conta. `launch` → atualiza `disabledCapabilities` com `withStoreLock`; regra do ref `{ kind: 'connector', id: '*' }` da Task 3 (desligar o último conector ligado adiciona `*`; ligar qualquer conector remove `*`). `account-file`/`global-file` → `serialize(<accountId>, () => adapter.setEnabled(...))`. `unsupported` → `fail(item.unsupportedReason)`. Depois de qualquer resultado, devolve a listagem relida.
- `backupRoot` = `join(deps.root, 'backups', 'capabilities', <timestamp ISO sem ':'>)`.

- [ ] **Step 1: Testes**: validação rejeita `kind: 'tool'`, `id: ''`; handler com conta Claude falsa grava `disabledCapabilities` e devolve item com `enabled: false`; desligar o último conector grava `*`; item `unsupported` → `{ ok: false, message: 'Desligue o plugin superpowers' }`; erro do adaptador em `account-file` → `ok: false` e a listagem não muda; canais registrados em `ipc.test.ts`/`preload.test.ts`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `Expose capability listing and toggles over IPC`.

### Task 10: Modal e engrenagem

**Files:**
- Create: `apps/desktop/src/renderer/AccountCapabilitiesModal.tsx`, `apps/desktop/src/renderer/capabilities-state.ts`, `apps/desktop/src/renderer/capabilities.css`
- Modify: `apps/desktop/src/renderer/AccountsView.tsx` (botão na coluna "Ações"), `apps/desktop/src/renderer/icons.tsx` (só se não existir ícone de engrenagem — `SettingsIcon` já existe; reuse)
- Test: `apps/desktop/test/capabilities-state.test.ts`

**Interfaces:**
- Consumes: Task 9 API.
- Produces (puro, testável):
  ```typescript
  export const CAPABILITY_TABS: readonly { kind: CapabilityKind; label: string }[]; // Skills, MCP, Conectores, Plugins
  export function visibleTabs(listing: CapabilityListing): CapabilityKind[];
  export function sortItems(items: readonly CapabilityItem[]): CapabilityItem[];
  export function filterItems(input: { items: readonly CapabilityItem[]; query: string }): CapabilityItem[];
  export function applyModeLabel(mode: CapabilityApplyMode): string; // 'Só no Inova' | 'Na conta' | 'Global' | 'Não configurável'
  ```

UI conforme spec "UI" e "Custo em tokens": aba com contador; resumo de custo nas abas MCP e Conectores (rótulos exatos do spec); aviso da aba Conectores (texto exato do spec); chave com estado de carregamento; `ConfirmModal` antes de item `global-file` (texto exato do spec); tooltip `unsupportedReason`; estado vazio do DeepSeek `Este provider não expõe itens configuráveis.`; rodapé `As mudanças valem a partir da próxima mensagem.`; botão engrenagem com `aria-label="Configurar skills, MCPs e plugins da conta"`.

- [ ] **Step 1: Testes**: `visibleTabs` esconde aba sem itens e sem erro, mantém aba com erro; `sortItems` ordena por `tokens` desc e coloca `null` no fim em ordem alfabética; `filterItems` casa por nome e descrição, sem diferenciar maiúsculas; `applyModeLabel` dos 4 modos.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Verificação visual: `pnpm --filter @inova/desktop dev`, abrir "Contas e providers", abrir a engrenagem da conta Claude, desligar e religar `claude.ai Gmail`; conferir que `store.json` muda e volta.
- [ ] **Step 6:** Commit `Add account capabilities modal`.

### Task 11: Changelog e verificação final

**Files:**
- Modify: `CHANGELOG.md` (seção `[Não lançado]` → `### Adicionado`)

- [ ] **Step 1:** Entrada: engrenagem por conta para desligar skills, MCPs, conectores e plugins; custo em tokens no Claude; onde cada mudança vale.
- [ ] **Step 2:** Rode na raiz: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run format:check`; em `apps/desktop`: `pnpm run typecheck`, `pnpm exec vitest run`. Todos verdes.
- [ ] **Step 3:** Commit `Add changelog entry for account capabilities`.

## Ordem e paralelismo

- Sequencial: 1 → 2.
- Paralelo (arquivos isolados): 3, 4, 5, 6, 8.
- Depois: 7 → 9 → 10 → 11.
