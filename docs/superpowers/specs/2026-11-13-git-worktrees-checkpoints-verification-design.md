# Inova IDE: Worktree por Sessão, Checkpoints Git e Verificação Pós-Turno

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Problema e escopo

Trabalhar com duas sessões no mesmo repositório gera conflitos de arquivo, e agentes podem fazer edições indesejadas ou quebrar o build sem feedback imediato.

Este subprojeto entrega três subsistemas integrados em `@inova/core` e `@inova/desktop`:

1. **Worktree automático por sessão**: isola cada sessão (ou grupo comparativo) em um `git worktree` e branch próprios.
2. **Checkpoints Git por turno**: cria snapshot automático antes de cada turno para desfazer alterações em um clique.
3. **Verificação automática pós-turno**: executa `typecheck`, `lint` ou `test` ao concluir o turno e permite reenviar falhas ao agente.

## 1. Worktree automático por sessão (`src/core/git-worktree.ts`)

### Modelo de dados (`src/core/types.ts`)

Adicionar em `Session`:

```typescript
export interface SessionWorktree {
  path: string;
  branch: string;
  baseCommit: string;
  createdAt: string;
}
```

`Session.worktree?: SessionWorktree | null` (`null` significa operar diretamente na pasta raiz do projeto).
`Project.autoWorktree?: boolean` define se novas sessões de nível raiz usam worktree isolado por padrão (`false` por padrão para manter compatibilidade).

### Ciclo de vida

1. **Criação (`createSessionWorktree`)**:
   - Valida que `project.path` é um repositório Git com pelo menos um commit (`git rev-parse --verify HEAD`). Se não for repositório Git ou não tiver commit inicial, retorna erro descritivo sem criar sessão quebrada.
   - Define `baseCommit = HEAD`, branch `inova/s-${shortId}` e diretório `<inovaRoot>/worktrees/<projectId>/<sessionId>` (fora da árvore do repositório para não sujar `git status`).
   - Executa `git -C <projectPath> worktree add -b <branch> <worktreePath> <baseCommit>`.
   - Regra para subsessões (`parentId !== null`): se a sessão pai tem `worktree` e o usuário não pediu isolamento separado, a subsessão pode herdar o mesmo `worktree` ou criar um novo a partir do `HEAD` do pai (configurável em `createSession`).
2. **Execução na sessão**:
   - `handlers.ts` resolve `effectiveCwd(session, project) = session.worktree?.path ?? project.path`.
   - `buildChatTurn`, `searchFiles` (`@arquivo`), checkpoints e verificação pós-turno usam sempre `effectiveCwd`.
3. **Ações do usuário e limpeza (`applyWorktreeToProject`, `removeSessionWorktree`)**:
   - Na barra da sessão (`SessionHeader` / `SessionDetails`), exibe chip com o nome da branch do worktree, contagem de arquivos alterados e botões:
     - **Ver diff**: abre resumo de alterações em relação a `baseCommit`.
     - **Aplicar na branch principal**: faz commit temporário ou gera patch (`git diff <baseCommit>..HEAD` + não rastreados) e aplica no repositório principal quando a árvore principal está limpa (ou recusa com mensagem clara se houver conflito).
   - Ao apagar sessão (`deleteSession`): verifica `git status --porcelain` no worktree; se houver alterações não aplicadas, exige confirmação na UI (`ConfirmModal` com `force: boolean`) antes de rodar `git worktree remove --force` e apagar a branch `inova/s-*`.

## 2. Checkpoints Git por turno (`src/core/git-checkpoints.ts`)

### Mecanismo sem sujar `git status` nem `git log`

Antes de iniciar cada turno (`runTurn`), se `effectiveCwd` for um repositório Git:

1. Cria um arquivo de índice temporário (`GIT_INDEX_FILE` em `os.tmpdir()`).
2. Inicializa esse índice a partir de `HEAD` (`git read-tree HEAD`, ou índice vazio se repo sem commits).
3. Lista arquivos rastreados modificados e não rastreados respeitando `.gitignore` (`git ls-files -z --cached --modified --others --exclude-standard`).
4. Inspeciona tamanho dos arquivos não rastreados alterados antes de indexar:
   - Arquivos acima do limite `MAX_CHECKPOINT_FILE_BYTES` (`10 * 1024 * 1024`, 10 MiB) ou binários grandes são ignorados na captura e listados em `skippedLargeFiles` para avisar o usuário (evitando travamento ou falha do Git).
5. Adiciona os caminhos filtrados ao índice temporário (`git update-index --add --remove -z --stdin`), gera a árvore (`git write-tree`) e cria um commit órfão (`git commit-tree <tree> [-p HEAD]`).
6. Grava uma referência interna `refs/inova/checkpoints/<sessionId>/<turnId>` via `git update-ref`. Remove o índice temporário no `finally`.

Esse fluxo não toca o `index` do usuário, não cria `stash`, não altera `HEAD` e funciona em repositórios limpos ou sujos.

### Restauração e retenção

- **Evento no transcript**: `ChatEvent` ganha `{ kind: 'checkpoint'; turnId: string; ref: string; createdAt: string; skippedLargeFiles: string[] }`.
- **Restauração (`restoreCheckpoint`)**:
  - Valida que nenhum turno está rodando na sessão.
  - Exige confirmação na UI quando há turnos posteriores ou alterações não salvas.
  - Executa `git checkout <ref> -- .` e remove apenas arquivos criados após o checkpoint (comparando `git ls-files --others --exclude-standard` contra a árvore do checkpoint, preservando arquivos ignorados pelo `.gitignore` e os `skippedLargeFiles`).
- **Limpeza**: ao apagar a sessão (`deleteSession`) ou passar do limite de retenção (últimos 50 checkpoints por sessão), remove as refs `refs/inova/checkpoints/<sessionId>/*` com `git update-ref -d`.

## 3. Verificação automática pós-turno (`src/core/verification.ts`)

### Configuração por projeto

Adicionar em `Project`:

```typescript
export interface VerificationCheck {
  id: string;
  label: string;
  command: string;
  enabled: boolean;
}
```

`Project.verificationChecks?: VerificationCheck[]` e `Project.autoVerify?: boolean`.

Ao vincular ou abrir configuração de um projeto, `detectProjectChecks(projectPath)` sugere automaticamente checks presentes em `package.json` (`typecheck`, `lint`, `test`), `Cargo.toml` (`cargo clippy`, `cargo test`), `pubspec.yaml` (`flutter analyze`, `flutter test`) ou `pyproject.toml` (`ruff`, `pytest`).

### Execução e exibição

1. **Gatilho**: após `done` com `isError: false` e não cancelado, se `project.autoVerify` estiver ativo e houver pelo menos um check habilitado (e, opcionalmente, se o turno executou ferramenta de escrita/shell ou `git status` mudou).
2. **Runner seguro**:
   - Executa cada check sequencialmente no `effectiveCwd` com `shell` do usuário, timeout por check (padrão 120s), kill de process-group no cancelamento e captura truncada dos últimos 16 KiB de saída.
   - Emite eventos `ChatEvent` do tipo `{ kind: 'verification'; turnId: string; status: 'running' | 'passed' | 'failed'; checks: VerificationCheckResult[] }` no transcript e na UI.
   - Se o usuário iniciar um novo turno ou cancelar, aborta a verificação em andamento.
3. **Botão "Reenviar falha ao agente"**:
   - Quando qualquer check retorna `status === 'failed'`, o card do turno no `ChatView` exibe os comandos que falharam, a saída colapsável e o botão **"Corrigir falha com o agente"**.
   - O clique envia (ou preenche no compositor se houver rascunho) um prompt estruturado contendo o comando e o trecho de erro do log.

## Plano de testes

- `src/core/git-worktree.test.ts`: criação, isolamento de alterações, detecção de dirty worktree, aplicação de diff e limpeza em repo Git temporário real.
- `src/core/git-checkpoints.test.ts`: captura antes do turno sem alterar `git status`, exclusão de arquivo > 10 MiB em `skippedLargeFiles`, restauração preservando `.gitignore`.
- `src/core/verification.test.ts`: detecção de scripts (`package.json`, `Cargo.toml`, etc.), timeout, truncamento de saída e cancelamento.
- `apps/desktop/test/handlers.test.ts`, `validation.test.ts`, `ipc.test.ts`, `preload.test.ts`: novos canais IPC (`createWorktree`, `applyWorktree`, `restoreCheckpoint`, `updateProjectChecks`, `runVerification`) e eventos `checkpoint` / `verification`.
