# Inova IDE: Autocomplete de arquivos (@) e comandos por projeto (/)

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Problema e escopo

O compositor do chat exige digitação manual de caminhos longos e não aproveita prompts nem skills já salvos no repositório. Isso gera erros de digitação, desperdício de tokens quando o usuário cola arquivos inteiros e retrabalho entre projetos.

Este subprojeto entrega dois recursos integrados ao compositor:

- Autocomplete `@arquivo` com respeito ao `.gitignore` e baixa latência em repositórios grandes.
- Menu `/comando` que lê prompts e skills existentes de Claude, Codex e Gemini no projeto e expande o conteúdo no compositor.

Fora de escopo deste subprojeto: anexar conteúdo completo de arquivo no prompt, ler comandos globais fora do projeto (`~/.claude`, `~/.codex`, `~/.gemini`), checkpoints Git, worktrees e caixa de entrada.

## Arquitetura em `@inova/core`

### Listagem e ranking de arquivos (`src/core/files.ts`)

1. `listProjectFiles(ctx)`:
   - Em repositórios Git, executa `git -C <projectPath> ls-files -z --cached --others --exclude-standard`.
   - Divide a saída pelo byte nulo `\0`, normaliza separadores para `/`, descarta entradas vazias e interrompe após `maxFiles` (padrão `50000`).
   - Quando o diretório não é um repositório Git (ou o binário `git` falha ao abrir repo), executa varredura assíncrona recursiva ignorando `.git` e `node_modules`, sem seguir symlinks que apontem para fora da raiz, até atingir `maxFiles`.
   - Retorna `{ files: string[]; truncated: boolean }`.
2. `rankProjectFiles(files, query, limit = 40)`:
   - Com `query` vazia, ordena lexicograficamente e retorna até `limit` caminhos.
   - Com `query` preenchida, compara em minúsculas por ordem de prioridade: nome base exato, prefixo do nome base, prefixo do caminho, substring no nome base, substring no caminho e subsequência fuzzy no caminho.
   - Desempata por menor comprimento de caminho e ordem alfabética.

### Descoberta e expansão de comandos (`src/core/commands.ts`)

`listProjectCommands(projectPath)` lê as seguintes origens relativas à raiz do projeto:

| Origem no projeto | Provedor | Tipo | Nome derivado |
| --- | --- | --- | --- |
| `.claude/commands/**/*.md` | `claude` | `command` | Caminho relativo sem `.md` (`/` vira `:`) |
| `.claude/skills/*/SKILL.md` | `claude` | `skill` | Frontmatter `name` ou nome da pasta |
| `.agents/skills/*/SKILL.md` | `codex` | `skill` | Frontmatter `name` ou nome da pasta |
| `.gemini/skills/*/SKILL.md` | `gemini` | `skill` | Frontmatter `name` ou nome da pasta |
| `.gemini/commands/**/*.toml` | `gemini` | `command` | Caminho relativo sem `.toml` (`/` vira `:`) |

Regras de parsing e segurança:

- Cada arquivo candidato tem seu `realpath` validado dentro do `realpath` de `projectPath`; symlinks externos são ignorados.
- Arquivos Markdown extraem frontmatter YAML opcional (`---`) para `name` e `description`; na falta de `description`, usam a primeira linha não vazia do corpo (até 120 caracteres).
- Arquivos TOML leem `description` e `prompt` (strings simples e multilinha); arquivos sem `prompt` válido são ignorados.
- Erros de leitura ou formato em um arquivo isolado ignoram apenas esse arquivo sem falhar o restante.
- `expandCommandPrompt(body, args)` substitui todas as ocorrências de `$ARGUMENTS` por `args.trim()`, ou anexa `args.trim()` ao final quando não há placeholder e `args` não é vazio.

## Contrato IPC e cache em `@inova/desktop`

### Tipos e canais (`apps/desktop/src/shared/api.ts`)

- `ProjectFileSearchResult`: `{ files: string[]; truncated: boolean }`.
- `ProjectCommandSource`: `'claude' | 'codex' | 'gemini'`.
- `ProjectCommandView`: `{ name: string; description: string; source: ProjectCommandSource; kind: 'command' | 'skill'; body: string }`.
- Canais adicionados em `CHANNELS`, `preload/index.ts` e `main/ipc.ts`:
  - `inova:searchFiles`: `(input: { projectId: string; query: string; limit?: number }) => Promise<Result<ProjectFileSearchResult>>`
  - `inova:listCommands`: `(input: { projectId: string }) => Promise<Result<ProjectCommandView[]>>`

### Validação e cache (`main/validation.ts` e `main/handlers.ts`)

- `parseFileSearch` valida `projectId`, `query` (string de 0 a 255 caracteres) e `limit` opcional (inteiro de 1 a 100).
- `listCommands` reutiliza `parseProjectRef`.
- `handlers.ts` mantém cache em memória de `listProjectFiles` por `projectId` com TTL de `5000 ms` e deduplicação de execução concorrente via promise compartilhada.
- O cache do `projectId` da sessão é invalidado automaticamente quando o turno do agente termina (`done`, `error` ou cancelamento).

## UI do compositor (`apps/desktop/src/renderer/`)

### Detecção de gatilhos (`composer-trigger.ts`)

- `detectComposerTrigger(text, cursor)` inspeciona o texto até o cursor:
  - Gatilho `@`: token `@[^\s]*` precedido pelo início do texto ou por espaço em branco.
  - Gatilho `/`: token `/[^\s]*` no início da linha atual até o cursor.
- `applyFileSuggestion(text, trigger, filePath)` substitui o intervalo por `@${filePath} ` e move o cursor para o fim da inserção.
- `applyCommandSuggestion(text, trigger, command)` substitui o intervalo pelo resultado de `expandCommandPrompt(command.body, '')` e posiciona o cursor no fim do texto expandido.

### `ComposerPopup.tsx` e `ChatView.tsx`

- `App.tsx` passa `projectId={session.projectId}` para `ChatView`.
- `ChatView` renderiza `ComposerPopup` acima de `.chat-composer` usando os tokens visuais existentes (`--panel`, `--surface`, `--border`, `--text`, `--muted`, `--accent`).
- Para `@`, dispara `window.inova.searchFiles` com debounce de `80 ms` e identificador incremental para descartar respostas antigas.
- Para `/`, carrega `window.inova.listCommands({ projectId })` ao ativar o gatilho e filtra localmente por `name` e `description`, exibindo a origem (`Claude`, `Codex`, `Gemini`).
- `ArrowUp` e `ArrowDown` movem a seleção; `Enter` e `Tab` aplicam o item selecionado sem enviar o formulário; `Escape` fecha o popup até nova edição.
- Mudança de sessão ou estado `readOnly` fecha o popup e limpa resultados pendentes.

## Plano de testes

- `src/core/files.test.ts`: listagem em repositório Git real com `.gitignore`, fallback sem Git ignorando `.git`/`node_modules`, teto `maxFiles` e ranking de `rankProjectFiles`.
- `src/core/commands.test.ts`: leitura de `.claude/commands`, `SKILL.md` em `.claude`, `.agents` e `.gemini`, `.gemini/commands/*.toml`, rejeição de symlink fora do projeto, tolerância a arquivo inválido e `expandCommandPrompt`.
- `apps/desktop/test/composer-trigger.test.ts`: detecção de `@` e `/`, atualização de texto e cursor.
- Extensões em `apps/desktop/test/validation.test.ts`, `handlers.test.ts` (cache TTL e invalidação pós-turno), `ipc.test.ts` e `preload.test.ts`.
