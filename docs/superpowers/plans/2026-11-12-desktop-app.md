# App desktop do inova (Plano B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Electron que lista projetos e contas do `inova` e abre cada projeto numa aba de terminal com o CLI oficial já na conta vinculada.

**Architecture:** `apps/desktop` é um pacote do workspace pnpm. O processo main reutiliza `src/` da raiz pelo alias `@inova/*` e roda cada sessão num `node-pty`. O renderer React só fala com o main por um contrato IPC tipado (`window.inova`). Ele manda ids e rótulos, nunca comandos ou env. Toda lógica com decisão (PATH, sessões, handlers, abas) fica em módulos puros testados com fakes. A casca Electron/React é fina e coberta por um selftest e pelo smoke manual.

**Tech Stack:** Electron, electron-vite, React 18+, `node-pty`, `@xterm/xterm` + `@xterm/addon-fit`, TypeScript strict, vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-12-multi-account-agent-launcher-design.md` (seção "App desktop (Plano B) — decisões")

## Global Constraints

- Todas as regras do Plano A continuam valendo: nunca ler, copiar, logar ou enviar token; binários oficiais sem modificação; remoção de variáveis de API key por provedor via `buildLaunch`/`buildLogin`.
- Dependências novas permitidas (só estas): runtime do desktop `react`, `react-dom`, `@xterm/xterm`, `@xterm/addon-fit`, `node-pty`; dev `electron`, `electron-vite`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@electron/rebuild`. Use a versão estável mais recente no momento do `pnpm add`; o lockfile registra.
- Root `package.json`: `"pnpm": { "onlyBuiltDependencies": ["electron", "esbuild", "node-pty"] }`. `pnpm-workspace.yaml`: `packages: ['apps/*']`.
- Nome do pacote: `@inova/desktop`. Alias `@inova/*` → `../../src/*` (tsconfig `paths` + `resolve.alias` do electron-vite em main e preload). Imports do desktop para o core não levam extensão: `@inova/core/providers`.
- Segurança Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; `setWindowOpenHandler(() => ({ action: 'deny' }))`; CSP no `index.html`: `default-src 'self'; style-src 'self' 'unsafe-inline'`.
- Env de toda sessão PTY: `{ ...process.env, PATH: <PATH do shell de login>, TERM: 'xterm-256color', COLORTERM: 'truecolor' }` passado como `baseEnv` para `buildLaunch`/`buildLogin`.
- Textos de UI em português.
- TS strict, sem `any`, sem comentários fora de `REGEX:`/`ALGORITHM:`/`NOTE:`, funções com > 3 parâmetros recebem objeto, commits ≤ 150 linhas (o lockfile pode exigir `HARNESS_ALLOW_LARGE=1` em commit só dele, já autorizado pelo usuário para lockfile).
- Checks antes de cada commit: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check && pnpm --filter @inova/desktop test && pnpm --filter @inova/desktop typecheck`.

## Review Focus

1. App aberto pelo Dock/Finder recebe `PATH` mínimo e não acha `claude` em `~/.local/bin` ou no nvm. Esperado: o PATH do shell de login é usado → testes em Task 2 e Task 4.
2. Fechar uma aba ou o app deixa `claude`/`gemini` órfãos. Esperado: o processo morre → testes em Task 3 (`close`, `closeAll`) e Task 1 (`window-all-closed` chama `closeAll`).
3. Renderer manda IPC forjado (provider `"x"`, rótulo vazio, `cols: NaN`, objeto sem campos). Esperado: `{ ok: false, message }` e nada é criado ou lançado → testes em Task 4.
4. Remover uma conta com aba aberta dessa conta. Esperado: recusa com mensagem; a sessão continua → teste em Task 4.
5. Binário não instalado (Codex hoje). Esperado: aba não abre; mensagem com a dica de instalação → teste em Task 4.

---

### Task 1: Workspace, casca Electron e selftest do node-pty

Prova primeiro o que mais pode falhar: `node-pty` nativo carregando no Electron e o alias `@inova/*` resolvendo o core pelo Vite.

**Files:**
- Create: `pnpm-workspace.yaml`, `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts` (vazio por enquanto: `export {}`), `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/test/selftest.test.ts`, `apps/desktop/vitest.config.ts`
- Modify: `package.json` (raiz: `pnpm.onlyBuiltDependencies`), `eslint.config.js` (incluir `**/*.tsx`; ignorar `apps/desktop/out`), `.gitignore` (`apps/desktop/out`), `.prettierignore` (`apps/desktop/out`)

**Interfaces:**
- Produces: `apps/desktop/package.json` com `"main": "out/main/index.js"`, `"private": true` e scripts `dev` (`electron-vite dev`), `build` (`electron-vite build`), `start` (`electron-vite preview`), `test` (`electron-vite build && vitest run`), `typecheck` (`tsc --noEmit`), `postinstall` (`electron-rebuild -f -w node-pty`). Saída do build em `apps/desktop/out/{main,preload,renderer}`.
- `tsconfig.json` único do desktop: `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `lib: ["ES2022","DOM"]`, `types: ["node"]`, strict + `noUncheckedIndexedAccess`, `paths: { "@inova/*": ["../../src/*"] }`, `include: ["src","test","*.ts"]`.

- [ ] **Step 1: Scaffold** os arquivos acima e rode `pnpm install` na raiz. Expected: o `postinstall` recompila `node-pty` para o Electron sem erro.
- [ ] **Step 2: Write the failing test** `apps/desktop/test/selftest.test.ts`:
  - `selftest spawns a pty and resolves the core`: roda o binário do Electron (`(await import('electron')).default` dá o caminho no Node) com `['out/main/index.js']`, `cwd` = `apps/desktop`, env `{ ...process.env, INOVA_SELFTEST: '1' }` sem `ELECTRON_RUN_AS_NODE`, timeout 30 s. Assert: exit code 0 e stdout contém `selftest:pty-ok:claude,codex,gemini`.
- [ ] **Step 3: Run** `pnpm --filter @inova/desktop test`. Expected: FAIL (sem saída de selftest).
- [ ] **Step 4: Implement** `src/main/index.ts`: com `INOVA_SELFTEST === '1'`, após `app.whenReady()`, abre `pty.spawn('/bin/echo', ['pty-ok'], …)`, junta a saída, imprime `selftest:${saida.trim()}:${Object.keys(providers).join(',')}` (import de `@inova/core/providers`) e chama `app.exit(0)`. Sem a variável: cria uma `BrowserWindow` 1200×800 com as opções de segurança das constraints, `title: 'Inova'`, carrega o renderer (URL do dev server em dev, arquivo em build). `window-all-closed` → `app.quit()`. O renderer mostra só `<h1>Inova</h1>` nesta task.
- [ ] **Step 5: Run** `pnpm --filter @inova/desktop test` e os checks globais. Expected: PASS. Rode `pnpm --filter @inova/desktop dev` e confira que a janela "Inova" abre.
- [ ] **Step 6: Commit** em blocos ≤ 150 linhas (workspace/config; main/renderer; teste). Lockfile em commit próprio.

---

### Task 2: PATH do shell de login e busca de binário

**Files:**
- Create: `apps/desktop/src/main/shell-env.ts`
- Test: `apps/desktop/test/shell-env.test.ts`

**Interfaces:**
- Produces:
  - `async function loginShellPath(ctx: { shell: string; fallback: string; timeoutMs: number }): Promise<string>` — roda `execFile(ctx.shell, ['-ilc', 'printf "__INOVA_PATH__%s" "$PATH"'], { timeout })` e devolve o texto depois do marcador `__INOVA_PATH__`. Qualquer falha (exit ≠ 0, timeout, marcador ausente, shell inexistente) devolve `ctx.fallback`.
  - `async function findBinary(name: string, pathValue: string): Promise<string | undefined>` — primeiro `join(dir, name)` de `pathValue.split(':')` (ignora vazios) que é arquivo e passa em `access(…, X_OK)`.

- [ ] **Step 1: Write the failing tests** (scripts fake em `mkdtemp`, `chmod 0o755`):
  - `loginShellPath returns PATH after marker even with rc noise` → shell fake que imprime `bem-vindo\n__INOVA_PATH__/a:/b` → `'/a:/b'`.
  - `loginShellPath falls back when shell fails` → shell fake `exit 3` → `fallback`.
  - `loginShellPath falls back when shell is missing` → `shell: '/nao/existe'` → `fallback`.
  - `loginShellPath falls back on timeout` → shell fake `sleep 5`, `timeoutMs: 200` → `fallback`.
  - `findBinary returns first executable match` → dois dirs com `claude` executável → caminho do primeiro.
  - `findBinary skips non-executable files and directories` → `claude` com `0o644` e um diretório `claude` → `undefined`.
- [ ] **Step 2: Run** `pnpm --filter @inova/desktop exec vitest run test/shell-env.test.ts`. Expected: FAIL (módulo ausente).
- [ ] **Step 3: Implement** `shell-env.ts`.
- [ ] **Step 4: Run** o teste e os checks globais. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Resolve login shell PATH and binaries for the desktop app"`.

---

### Task 3: Gerente de sessões PTY

**Files:**
- Create: `apps/desktop/src/main/sessions.ts`
- Test: `apps/desktop/test/sessions.test.ts`

**Interfaces:**
- Consumes: `LaunchSpec` de `@inova/core/launch`.
- Produces:
  - `interface PtyProcess { onData(cb: (data: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void; write(data: string): void; resize(cols: number, rows: number): void; kill(): void }`
  - `type SpawnPty = (input: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }) => PtyProcess`
  - `interface SessionEvents { data(sessionId: string, data: string): void; exit(sessionId: string, exitCode: number): void }`
  - `interface SessionManager { open(input: { spec: LaunchSpec; file: string; accountId: string; cols: number; rows: number }): string; write(sessionId: string, data: string): void; resize(input: { sessionId: string; cols: number; rows: number }): void; close(sessionId: string): void; closeAll(): void; accountsInUse(): ReadonlySet<string> }`
  - `function createSessionManager(deps: { spawnPty: SpawnPty; events: SessionEvents }): SessionManager`
  - `function clampSize(cols: number, rows: number): { cols: number; rows: number }` — valor não finito ou < 1 → 80×24 (por eixo); máximo 500 por eixo; arredonda para inteiro.
- `open` usa `file` (caminho absoluto do binário) no lugar de `spec.command`; `args`, `cwd` e `env` vêm do `spec`. Id = `randomUUID()`. `write`/`resize`/`close` com id desconhecido não fazem nada. Na saída do processo: emite `exit` e remove a sessão.

- [ ] **Step 1: Write the failing tests** com `SpawnPty` fake que grava as chamadas e expõe `emitData`/`emitExit`:
  - `open spawns with absolute file and spec args, cwd and env`
  - `data and exit are forwarded with the session id; exit frees the account`
  - `close kills the process and frees the account`
  - `closeAll kills every open session`
  - `unknown session ids are ignored` (write/resize/close não lançam e não chamam o fake)
  - `clampSize`: `(NaN, 0)` → `{80, 24}`; `(10_000, 30.6)` → `{500, 31}`.
- [ ] **Step 2: Run** `pnpm --filter @inova/desktop exec vitest run test/sessions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `sessions.ts` com um `Map<string, { pty: PtyProcess; accountId: string }>`. `open` e `resize` passam por `clampSize`.
- [ ] **Step 4: Run** o teste e os checks globais. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add PTY session manager"`.

---

### Task 4: Contrato IPC, handlers, preload e ligação no main

**Files:**
- Create: `apps/desktop/src/shared/api.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/test/handlers.test.ts`

**Interfaces:**
- Consumes: core (`loadStore`, `dataRoot`, `addAccount`, `removeAccount`, `findAccount`, `AccountError`, `bindProject`, `unbindProject`, `PathNotFoundError`, `StoreCorruptError`, `providers`, `isProviderId`, `buildLaunch`, `buildLogin`, `CommandRunner`, `AuthStatus`), `nodeRunner` de `@inova/node-io`, Task 2 (`loginShellPath`, `findBinary`), Task 3 (`SessionManager`, `createSessionManager`).
- Produces em `shared/api.ts`:
  - `type Result<T> = { ok: true; value: T } | { ok: false; message: string }`
  - `interface AccountView { id: string; label: string; provider: ProviderId; status: AuthStatus }`
  - `interface ProjectView { id: string; path: string; accountLabel: string; provider: ProviderId }`
  - `interface OpenedSession { sessionId: string; title: string }`
  - `interface InovaApi { listAccounts(): Promise<Result<AccountView[]>>; addAccount(input: { provider: string; label: string }): Promise<Result<AccountView>>; removeAccount(input: { label: string; force: boolean }): Promise<Result<null>>; listProjects(): Promise<Result<ProjectView[]>>; pickFolder(): Promise<string | null>; bindProject(input: { path: string; accountLabel: string }): Promise<Result<ProjectView>>; unbindProject(input: { path: string }): Promise<Result<null>>; openProject(input: { projectId: string; cols: number; rows: number }): Promise<Result<OpenedSession>>; openLogin(input: { accountLabel: string; cols: number; rows: number }): Promise<Result<OpenedSession>>; ptyWrite(sessionId: string, data: string): void; ptyResize(input: { sessionId: string; cols: number; rows: number }): void; ptyClose(sessionId: string): void; onPtyData(cb: (e: { sessionId: string; data: string }) => void): () => void; onPtyExit(cb: (e: { sessionId: string; exitCode: number }) => void): () => void }`
  - `const CHANNELS` com um nome por método (`'inova:listAccounts'`, …, `'inova:pty:data'`, `'inova:pty:exit'`).
- Produces em `handlers.ts`: `function createHandlers(deps: { root: string; runner: CommandRunner; sessions: SessionManager; baseEnv: () => Promise<NodeJS.ProcessEnv>; pickFolder: () => Promise<string | null> })` → objeto com os métodos assíncronos de `InovaApi` exceto `pty*` e `on*`. Cada método recebe `unknown` e valida antes de usar.

Regras dos handlers:
- Validação: input deve ser objeto; strings não vazias com ≤ 255 caracteres; `provider` passa em `isProviderId`; `force` é boolean; `cols`/`rows` são `number`. Falha → `{ ok: false, message: 'Entrada inválida.' }`, sem tocar no store.
- `AccountError`, `PathNotFoundError`, `StoreCorruptError` → `{ ok: false, message: error.message }`. Outros erros propagam.
- `listAccounts`: status via `providers[p].checkStatus({ homeDir, env: buildLaunch({ account, cwd: homeDir, args: [], baseEnv }).env, runner })`.
- `removeAccount`: se `sessions.accountsInUse()` tem a conta → `{ ok: false, message: 'Feche as abas desta conta antes de removê-la.' }`.
- `openProject`/`openLogin`: `findBinary(adapter.binary, baseEnv.PATH ?? '')`; ausente → `{ ok: false, message: \`${binary} não encontrado. Instale: ${installHint}\` }`. `openProject` chama `prepareLaunch(account.homeDir)` antes de `buildLaunch({ account, cwd: project.path, args: [], baseEnv })`. `title`: projeto → `` `${basename(path)} · ${label}` ``; login → `` `login · ${label}` ``. Projeto ou conta inexistente → `{ ok: false, message: 'Projeto não encontrado.' }` / mensagem do `AccountError`.

`ipc.ts`: `registerIpc(deps: { handlers: ReturnType<typeof createHandlers>; sessions: SessionManager })` liga `ipcMain.handle` para os métodos assíncronos e `ipcMain.on` para `ptyWrite`/`ptyResize`/`ptyClose`, descartando args com tipo errado. `main/index.ts`: `baseEnv` memoizado = env das constraints com `loginShellPath({ shell: process.env.SHELL ?? '/bin/zsh', fallback: process.env.PATH ?? '', timeoutMs: 5000 })`; `SpawnPty` real com `node-pty`; eventos de sessão → `win.webContents.send`; `window-all-closed` → `sessions.closeAll()` e depois `app.quit()`. `pickFolder` usa `dialog.showOpenDialog({ properties: ['openDirectory'] })`. `preload/index.ts` expõe `InovaApi` em `window.inova` via `contextBridge` e declara `window.inova` em `shared/api.ts` (`declare global`).

- [ ] **Step 1: Write the failing tests** em `handlers.test.ts` (`root` em `mkdtemp`+`realpath`, runner fake, `SessionManager` fake que grava `open`, `baseEnv` com `PATH` apontando para um dir tmp com `claude` executável fake):
  - `addAccount rejects unknown provider and empty label without touching the store` (`{ provider: 'x', label: 'a' }`, `{ provider: 'claude', label: '' }`, `null`) → `ok: false`, `message: 'Entrada inválida.'`, store sem contas.
  - `listAccounts reports status with api keys stripped` → `baseEnv` com `ANTHROPIC_API_KEY`; o runner fake recebe env sem ela.
  - `openProject spawns absolute binary in project dir with account isolation` → `open` recebe `file` = caminho absoluto do fake, `spec.cwd` = caminho do projeto, `spec.env.CLAUDE_CONFIG_DIR` = home da conta, `spec.env.TERM` = `'xterm-256color'`; `title` = `` `${basename} · pessoal` ``.
  - `openProject marks claude onboarding before launch` → `.claude.json` da conta ganha `hasCompletedOnboarding: true`.
  - `openProject reports missing binary with install hint` → `PATH` sem `claude` → `ok: false`, mensagem contém `pnpm add -g @anthropic-ai/claude-code`; `open` não foi chamado.
  - `openProject rejects NaN size gracefully` → `cols: NaN` aceito (é number) e repassado; o clamp é da Task 3. `cols: '80'` → `Entrada inválida.`
  - `removeAccount refuses while a session of the account is open` → fake com a conta em `accountsInUse` → mensagem exata; conta continua no store.
  - `bindProject maps PathNotFoundError to a message` → caminho inexistente → `ok: false`, mensagem `Caminho não encontrado: …`.
- [ ] **Step 2: Run** `pnpm --filter @inova/desktop exec vitest run test/handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `shared/api.ts`, `handlers.ts`, `ipc.ts`, preload e a ligação em `main/index.ts`.
- [ ] **Step 4: Run** o teste, o selftest (`pnpm --filter @inova/desktop test`) e os checks globais. Expected: PASS.
- [ ] **Step 5: Commit** em blocos ≤ 150 linhas (contrato+handlers; testes; ipc+preload+main).

---

### Task 5: Interface React (barra lateral e abas de terminal)

**Files:**
- Create: `apps/desktop/src/renderer/tabs.ts`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/Sidebar.tsx`, `apps/desktop/src/renderer/TerminalView.tsx`, `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/main.tsx`
- Test: `apps/desktop/test/tabs.test.ts`

**Interfaces:**
- Consumes: `window.inova: InovaApi`, `AccountView`, `ProjectView`, `OpenedSession` (Task 4).
- Produces em `tabs.ts`:
  - `interface Tab { sessionId: string; title: string; exited: boolean }`
  - `interface TabsState { tabs: Tab[]; active: string | null }`
  - `type TabsAction = { type: 'open'; tab: OpenedSession } | { type: 'close'; sessionId: string } | { type: 'activate'; sessionId: string } | { type: 'exited'; sessionId: string }`
  - `function tabsReducer(state: TabsState, action: TabsAction): TabsState`

Comportamento da UI:
- **Barra lateral, "Projetos":** um item por `ProjectView` (nome da pasta + rótulo da conta). Clique → `openProject` com o tamanho do terminal ativo (ou 120×32). Botão "Adicionar projeto" → `pickFolder` → seletor de conta → `bindProject`. Botão de desvincular por item.
- **Barra lateral, "Contas":** rótulo, provedor e status (`logged-in` = "conectada", `logged-out` = "desconectada", `binary-missing` = "CLI não instalado", `unknown` = "desconhecido"). Botões "Entrar" (`openLogin`) e "Remover" (confirmação nativa `confirm('Remover a conta <rótulo>? Os projetos vinculados a ela serão desvinculados.')`, depois `removeAccount` com `force: true`). Formulário "Nova conta": provedor (select das 3 opções) + rótulo → `addAccount`. Recarregue as contas ao fechar uma aba de login.
- **Abas:** todas as `TerminalView` ficam montadas; só a ativa é visível (`display: none` nas outras), para não perder o buffer. `TerminalView` cria um `Terminal` do xterm com `FitAddon`, liga `onData` → `ptyWrite`, filtra `onPtyData`/`onPtyExit` pelo `sessionId`, chama `fit()` + `ptyResize` num `ResizeObserver`, e faz `dispose` no unmount. Fechar aba → `ptyClose` + `close`. Aba de processo encerrado mostra "(encerrado)" no título.
- **Erros:** qualquer `{ ok: false }` aparece numa faixa de aviso no topo, que some em 6 s ou no clique.

- [ ] **Step 1: Write the failing tests** em `tabs.test.ts`:
  - `open appends and activates the new tab`
  - `closing the active tab activates the previous one, else the next, else null`
  - `closing an inactive tab keeps the active one`
  - `exited marks the tab and keeps it open`
  - `unknown session ids leave the state unchanged` (mesma referência de objeto)
- [ ] **Step 2: Run** `pnpm --filter @inova/desktop exec vitest run test/tabs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `tabs.ts`, depois os componentes e `styles.css` (layout: barra lateral 280 px + área de abas; terminal ocupa o resto; tema escuro).
- [ ] **Step 4: Run** o teste, `pnpm --filter @inova/desktop test` e os checks globais. Expected: PASS. Rode `pnpm --filter @inova/desktop dev` e confira que a barra lateral lista as contas e projetos reais de `~/.inova` (somente leitura: não clique em nada que crie ou remova).
- [ ] **Step 5: Commit** em blocos ≤ 150 linhas (reducer+teste; componentes; estilos).

---

### Task 6: Smoke manual (usuário)

Login OAuth e o comportamento do terminal real exigem a pessoa na frente da tela.

- [ ] **Step 1:** `pnpm --filter @inova/desktop build && pnpm --filter @inova/desktop start`, aberto a partir de um terminal.
- [ ] **Step 2:** Clique no projeto `deepful`. Expected: aba abre o Claude; `/status` mostra a organização Deepful.
- [ ] **Step 3:** Vincule outra pasta à conta `pessoal` e abra. Expected: duas abas ao mesmo tempo, cada uma com a sua organização.
- [ ] **Step 4:** Ctrl-C dentro de uma aba. Expected: interrompe a resposta do Claude; o app continua aberto.
- [ ] **Step 5:** Feche uma aba e rode `pgrep -fl claude` num terminal. Expected: o processo daquela aba sumiu. Feche o app. Expected: nenhum processo das abas sobra.
- [ ] **Step 6:** Tente remover a conta com aba aberta. Expected: mensagem "Feche as abas desta conta antes de removê-la."
- [ ] **Step 7:** Simule o app aberto pelo Dock, com `PATH` mínimo. Rode `cd apps/desktop && E=$(node -p "require('electron')") && env -i HOME="$HOME" SHELL="$SHELL" PATH=/usr/bin:/bin "$E" .` Expected: as contas mostram status real (não "CLI não instalado") e o projeto abre.
