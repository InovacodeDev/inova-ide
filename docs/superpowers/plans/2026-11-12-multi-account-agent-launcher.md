# Launcher multi-conta (core + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI `inova` que cria contas isoladas de Claude/Codex/Gemini, vincula projetos a contas e abre o CLI oficial do provedor no projeto com a conta certa.

**Architecture:** Um pacote TS. `src/core/` tem lógica pura e testável (adapters como dados, store JSON, contas, projetos, `buildLaunch`). `src/cli.ts` é a borda: parse de args com `node:util` `parseArgs` e `spawn` com `stdio: 'inherit'`. O app desktop (Plano B) vai importar o mesmo `core`.

**Tech Stack:** Node 24, TypeScript strict, pnpm, vitest, ESLint flat + typescript-eslint, Prettier. Sem dependência de runtime.

**Spec:** `docs/superpowers/specs/2026-11-12-multi-account-agent-launcher-design.md`

## Global Constraints

- Nenhum código lê, copia, loga ou envia token. Status só por comando oficial ou existência de arquivo.
- Binários oficiais rodam sem modificação: `claude`, `codex`, `gemini`.
- Raiz de dados: `process.env.INOVA_HOME ?? ~/.inova`. Store em `<raiz>/store.json`. Contas em `<raiz>/accounts/<id>/`, criadas com modo `0o700`.
- Variáveis removidas do env do filho: claude → `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`; codex → `OPENAI_API_KEY`, `CODEX_API_KEY`; gemini → `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`.
- TS strict com `noUncheckedIndexedAccess`; sem `any`; Prettier singleQuote, trailingComma all, printWidth 100.
- Sem comentários fora das tags `REGEX:`/`ALGORITHM:`/`NOTE:`.
- Funções com mais de 3 parâmetros recebem objeto.
- Commits em inglês, imperativo. Nunca commitar `graft/`, `.harness.json`, `.claude-flow/`.

## Review Focus

1. Shell do usuário com `ANTHROPIC_API_KEY` exportada: o filho deve usar a conta OAuth, não a key → teste em Task 4.
2. Binário ausente (Codex não está instalado hoje): `account list` mostra `binary-missing`; `run` sai com código 127 e dica de instalação, sem stack trace → testes em Task 3 e Task 5.
3. `cwd` em subpasta de projeto, ou em projetos aninhados: vence o caminho mais longo; fora de projeto = erro claro → teste em Task 4.
4. Remover conta: apaga só `<raiz>/accounts/<id>`; recusa se há projeto vinculado (sem `--force`); recusa se o caminho resolvido sai da raiz → teste em Task 3.
5. `store.json` ausente = store vazio; corrompido = erro com o caminho do arquivo, nunca sobrescreve → teste em Task 2.

---

### Task 1: Spike de isolamento (manual, sem código)

Prova a premissa do spec. Se falhar, pare e reporte: o resto do plano depende disto.

- [ ] **Step 1: Claude, duas contas.** Rode com duas contas Claude diferentes (o usuário completa o login no navegador):

```bash
CLAUDE_CONFIG_DIR=/tmp/inova-spike/c1 claude auth login
```

```bash
CLAUDE_CONFIG_DIR=/tmp/inova-spike/c2 claude auth login
```

- [ ] **Step 2: Confirme identidades distintas.**

```bash
CLAUDE_CONFIG_DIR=/tmp/inova-spike/c1 claude auth status --text
```

```bash
CLAUDE_CONFIG_DIR=/tmp/inova-spike/c2 claude auth status --text
```

Expected: cada um mostra um e-mail diferente; `claude auth status --text` sem a variável continua mostrando a conta original.

- [ ] **Step 3: Confirme entradas de Keychain distintas** (lista só nomes de serviço, sem segredo):

```bash
security dump-keychain | grep -o '"svce"<blob>="Claude Code[^"]*"' | sort -u
```

Expected: duas entradas novas com sufixo.

- [ ] **Step 4: Gemini.** Rode `GEMINI_CLI_HOME=/tmp/inova-spike/g1 gemini`, escolha "Login with Google", saia. Expected: existe `/tmp/inova-spike/g1/.gemini/oauth_creds.json` e `~/.gemini` não mudou de data.
- [ ] **Step 5: Codex** (se instalado). `CODEX_HOME=/tmp/inova-spike/x1 codex login` e depois `codex login status` com a mesma variável. Expected: exit 0. Confirme na doc oficial do Codex o nome da chave `cli_auth_credentials_store` usada na Task 3. Se não instalado, registre "não verificado".
- [ ] **Step 6: Registre o resultado** em `docs/superpowers/specs/2026-11-12-multi-account-agent-launcher-design.md`, seção "Evidência local". Apague `/tmp/inova-spike` com `claude auth logout` em cada home antes.

---

### Task 2: Scaffold + tipos + store

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `vitest.config.ts`
- Create: `src/core/types.ts`, `src/core/store.ts`
- Test: `src/core/store.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderId = 'claude' | 'codex' | 'gemini'`
  - `interface Account { id: string; provider: ProviderId; label: string; homeDir: string; createdAt: string }`
  - `interface Project { id: string; path: string; accountId: string }`
  - `interface Store { version: 1; accounts: Account[]; projects: Project[] }`
  - `function dataRoot(env: NodeJS.ProcessEnv): string`
  - `async function loadStore(root: string): Promise<Store>`
  - `async function saveStore(root: string, store: Store): Promise<void>`
  - `class StoreCorruptError extends Error { readonly path: string }`

- [ ] **Step 1: Scaffold.** `package.json` com `"type": "module"`, `"bin": { "inova": "dist/cli.js" }`, scripts `build` (`tsc`), `typecheck` (`tsc --noEmit`), `lint` (`eslint . --max-warnings 0`), `test` (`vitest run`), `format:check` (`prettier --check .`). Dev deps: `typescript`, `vitest`, `@types/node`, `eslint`, `typescript-eslint`, `prettier`. `.gitignore`: `node_modules`, `dist`, `graft/`, `.harness.json`, `.claude-flow/`. Rode `pnpm install`.
- [ ] **Step 2: Write the failing tests** em `src/core/store.test.ts` (use `fs.mkdtemp` em `os.tmpdir()`):
  - `loadStore returns empty store when file is missing` → `{ version: 1, accounts: [], projects: [] }`
  - `saveStore then loadStore round-trips`
  - `loadStore throws StoreCorruptError with file path on invalid JSON` → `err.path === join(root, 'store.json')`, e o arquivo fica intacto byte a byte.
  - `dataRoot prefers INOVA_HOME` → `dataRoot({ INOVA_HOME: '/x' }) === '/x'`; sem a variável → `join(os.homedir(), '.inova')`.
- [ ] **Step 3: Run** `pnpm test src/core/store.test.ts`. Expected: FAIL (módulo não existe).
- [ ] **Step 4: Implement** `types.ts` e `store.ts`. `saveStore` grava em `store.json.tmp` e faz `rename` (escrita atômica). `loadStore` valida forma mínima (`version === 1`, arrays); forma inválida também lança `StoreCorruptError`.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add project scaffold and JSON store"` (adicione arquivos por nome).

---

### Task 3: Adapters de provedor + contas

**Files:**
- Create: `src/core/providers.ts`, `src/core/accounts.ts`
- Test: `src/core/providers.test.ts`, `src/core/accounts.test.ts`

**Interfaces:**
- Consumes: `Store`, `Account`, `ProviderId`, `loadStore`, `saveStore` (Task 2).
- Produces:
  - `type AuthStatus = 'logged-in' | 'logged-out' | 'binary-missing' | 'unknown'`
  - `interface CommandRunner { run(cmd: { command: string; args: string[]; env: NodeJS.ProcessEnv }): Promise<{ exitCode: number; stdout: string } | { notFound: true }> }`
  - `interface ProviderAdapter { id: ProviderId; binary: string; homeEnvVar: string; strippedEnvVars: readonly string[]; loginArgs: readonly string[]; installHint: string; initHome(homeDir: string): Promise<void>; checkStatus(ctx: { homeDir: string; env: NodeJS.ProcessEnv; runner: CommandRunner }): Promise<AuthStatus> }`
  - `const providers: Record<ProviderId, ProviderAdapter>`
  - `function isProviderId(value: string): value is ProviderId`
  - `async function addAccount(ctx: { root: string; provider: ProviderId; label: string }): Promise<Account>`
  - `async function removeAccount(ctx: { root: string; label: string; force: boolean }): Promise<void>`
  - `function findAccount(store: Store, label: string): Account | undefined`
  - `class AccountError extends Error { readonly code: 'duplicate-label' | 'not-found' | 'has-projects' | 'unsafe-path' }`

Valores por provedor (copie do spec):

| id | binary | homeEnvVar | loginArgs | checkStatus | initHome |
| --- | --- | --- | --- | --- | --- |
| claude | `claude` | `CLAUDE_CONFIG_DIR` | `['auth','login']` | `claude auth status --json` → JSON `loggedIn: true` = logged-in; `false` = logged-out; JSON inválido = unknown | nada |
| codex | `codex` | `CODEX_HOME` | `['login']` | `codex login status` → exit 0 = logged-in, outro = logged-out | grava `config.toml` com `cli_auth_credentials_store = "file"` se não existir |
| gemini | `gemini` | `GEMINI_CLI_HOME` | `[]` | `<home>/.gemini/oauth_creds.json` existe = logged-in; senão logged-out (não executa binário; checa binário via `runner` com `['--version']` → notFound = binary-missing) | nada |

`installHint`: claude → `pnpm add -g @anthropic-ai/claude-code`; codex → `pnpm add -g @openai/codex`; gemini → `pnpm add -g @google/gemini-cli`.

- [ ] **Step 1: Write the failing tests** em `providers.test.ts` com um `CommandRunner` fake:
  - `claude status parses loggedIn true` → `'logged-in'`; e verifica que o runner recebeu `env.CLAUDE_CONFIG_DIR === homeDir`.
  - `claude status returns unknown on non-JSON output`
  - `status returns binary-missing when runner reports notFound` (os três provedores)
  - `gemini status is logged-in only when oauth_creds.json exists` (crie o arquivo vazio no tmp)
  - `codex initHome writes file credential store and keeps existing config.toml`
- [ ] **Step 2: Write the failing tests** em `accounts.test.ts`:
  - `addAccount creates home with mode 0700 and persists` → `(stat.mode & 0o777) === 0o700`; `homeDir === join(root,'accounts',account.id)`.
  - `addAccount rejects duplicate label` → `AccountError` `duplicate-label` (rótulo único entre todos os provedores).
  - `removeAccount refuses when projects are bound` → `has-projects`; com `force: true` remove a conta e os projetos vinculados do store.
  - `removeAccount refuses homeDir outside accounts root` → store com `homeDir: '/etc'` lança `unsafe-path` e não apaga nada.
  - `removeAccount deletes only the account home` → um arquivo irmão em `root/accounts/outro` continua existindo.
- [ ] **Step 3: Run** `pnpm test src/core`. Expected: FAIL.
- [ ] **Step 4: Implement** `providers.ts` e `accounts.ts`. `id` = `crypto.randomUUID()`. Checagem de caminho: `path.relative(join(root,'accounts'), resolve(homeDir))` não pode começar com `..` nem ser absoluto nem vazio.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add provider adapters and account management"`.

---

### Task 4: Projetos + buildLaunch

**Files:**
- Create: `src/core/projects.ts`, `src/core/launch.ts`
- Test: `src/core/projects.test.ts`, `src/core/launch.test.ts`

**Interfaces:**
- Consumes: `Store`, `Account`, `Project`, `providers`, `findAccount` (Tasks 2–3).
- Produces:
  - `async function bindProject(ctx: { root: string; path: string; accountLabel: string }): Promise<Project>` — `path` vira `realpath`; vincular de novo o mesmo caminho troca a conta (não duplica).
  - `async function unbindProject(ctx: { root: string; path: string }): Promise<void>`
  - `function resolveProject(store: Store, cwd: string): Project | undefined` — maior prefixo de caminho, comparando por segmento.
  - `interface LaunchSpec { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }`
  - `function buildLaunch(ctx: { account: Account; cwd: string; args: readonly string[]; baseEnv: NodeJS.ProcessEnv }): LaunchSpec`
  - `function buildLogin(ctx: { account: Account; baseEnv: NodeJS.ProcessEnv }): LaunchSpec` — mesma env, `args = loginArgs`, `cwd = account.homeDir`.

- [ ] **Step 1: Write the failing tests** em `projects.test.ts`:
  - `resolveProject picks longest matching prefix` → projetos `/a` e `/a/b`; `cwd /a/b/c` → `/a/b`.
  - `resolveProject does not match sibling prefix` → projeto `/a/b`, `cwd /a/bc` → `undefined`.
  - `bindProject rebinding same path replaces account` → `store.projects.length === 1`.
  - `bindProject rejects unknown account label` → `AccountError` `not-found`.
- [ ] **Step 2: Write the failing tests** em `launch.test.ts`:
  - `buildLaunch sets isolation var and strips provider api keys` → `baseEnv` com `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `PATH`; resultado tem `CLAUDE_CONFIG_DIR === account.homeDir`, `PATH` preservado, as duas keys ausentes.
  - `buildLaunch does not mutate baseEnv`
  - `buildLaunch for codex strips OPENAI_API_KEY but keeps ANTHROPIC_API_KEY` (só remove as do próprio provedor).
  - `buildLogin uses provider loginArgs` → claude `['auth','login']`.
- [ ] **Step 3: Run** `pnpm test src/core`. Expected: FAIL.
- [ ] **Step 4: Implement** `projects.ts` e `launch.ts`. `buildLaunch` é pura: copia `baseEnv`, apaga `strippedEnvVars`, define `homeEnvVar`.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Add project binding and launch spec builder"`.

---

### Task 5: CLI `inova`

**Files:**
- Create: `src/cli.ts`, `src/core/node-runner.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: tudo de Tasks 2–4.
- Produces:
  - `const nodeRunner: CommandRunner` — `execFile`; `ENOENT` → `{ notFound: true }`.
  - `async function main(ctx: { argv: string[]; env: NodeJS.ProcessEnv; cwd: string; io: CliIO }): Promise<number>` — retorna exit code; `cli.ts` faz `process.exit(await main(...))`.
  - `interface CliIO { out(line: string): void; err(line: string): void; runner: CommandRunner; spawnInteractive(spec: LaunchSpec): Promise<number | 'not-found'> }`

Comandos:

| Comando | Efeito |
| --- | --- |
| `inova account add <claude\|codex\|gemini> <label>` | `addAccount` + `initHome`; imprime `Rode: inova account login <label>` |
| `inova account login <label>` | `spawnInteractive(buildLogin(...))` |
| `inova account list` | uma linha por conta: `label  provider  status`; `checkStatus` recebe `env` de `buildLaunch(...)`, para que API keys do shell não mascarem o status |
| `inova account rm <label> [--force]` | `removeAccount` |
| `inova project bind <label> [path]` | `bindProject`, `path` default = `cwd` |
| `inova project unbind [path]` | `unbindProject` |
| `inova project list` | `path  label` |
| `inova run [-- args...]` | `resolveProject(cwd)` → `spawnInteractive(buildLaunch(...))`; repassa o exit code do filho |

Códigos de saída: `0` ok; `1` erro de uso/`AccountError`/`StoreCorruptError` (mensagem em uma linha via `io.err`, sem stack); `2` `run` fora de projeto vinculado (`Nenhum projeto vinculado a <cwd>. Rode: inova project bind <label>`); `127` binário ausente (`<binary> não encontrado. Instale: <installHint>`).

- [ ] **Step 1: Write the failing tests** em `cli.test.ts` com `io` fake e `INOVA_HOME` em tmp:
  - `account add then list shows logged-out` (runner fake retorna claude `loggedIn:false`).
  - `run outside bound project exits 2 with bind hint`
  - `run exits 127 with install hint when binary missing` (`spawnInteractive` retorna `'not-found'`).
  - `run passes args after -- and exit code from child` → `spawnInteractive` recebe `args: ['--resume']`, retorna 3 → `main` retorna 3.
  - `corrupt store prints path and exits 1`
  - `unknown provider exits 1 listing valid providers`
- [ ] **Step 2: Run** `pnpm test src/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `node-runner.ts` e `cli.ts` com `parseArgs` de `node:util`. `spawnInteractive` real usa `spawn(command, args, { cwd, env, stdio: 'inherit' })`; evento `error` com `ENOENT` → `'not-found'`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Smoke manual.** `pnpm build && pnpm link --global`. Depois:

```bash
inova account add claude pessoal && inova account login pessoal && inova project bind pessoal ~/Inovacode/finiza && cd ~/Inovacode/finiza && inova run
```

Expected: o Claude Code abre já logado na conta `pessoal`; dentro dele `/status` mostra o e-mail certo.
- [ ] **Step 6: Commit** `git commit -m "Add inova CLI"`.

---

## Próximo plano (B): app desktop

Escreva depois que o Plano A passar no smoke. Esboço: `apps/desktop` com Electron + React; processo main importa `core` e abre um `node-pty` por aba com `buildLaunch()`; renderer usa `xterm.js`; barra lateral lista projetos (`loadStore`) e status das contas (`checkStatus`). O plano A vira pacote do workspace `packages/core` nessa hora, não antes.
