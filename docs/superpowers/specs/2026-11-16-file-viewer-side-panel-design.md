# Design: Painel Lateral de Leitura de Arquivos e Preview HTML

Data: 2026-11-16
Status: Aprovado

## 1. Resumo e Escopo

Este design adiciona um painel lateral de leitura de arquivos padrão VS Code (`FileViewerPane`) no `@inova/desktop` (`apps/desktop`).

Objetivos principais:

- Abrir arquivos gerados, editados ou citados pelo LLM com um clique diretamente na conversa, nos cards de ferramentas ou na lista de alterações Git.
- Permitir arrastar ou selecionar qualquer arquivo local para análise no mesmo painel.
- Suportar visualização somente leitura para código-fonte, texto, Markdown, HTML (em navegador embutido), planilhas (`XLS`, `XLSX`, `CSV`, `TSV`), imagens, PDF e fallback de metadados para binários.
- Permitir redimensionar o painel e maximizá-lo para ocupar toda a largura útil da área de trabalho.

## 2. Arquitetura de Layout e Estado

### 2.1 Posicionamento e Maximização (`App.tsx`, `SessionHeader.tsx`, `session.css`)

- `FileViewerPane` renderiza dentro de `.session-stage`, posicionado à direita de `.session-panes` e à esquerda de `SessionDetails`.
- Uma alça arrastável na borda esquerda permite redimensionar o painel entre `320px` e `70%` da largura de `.session-stage` (padrão `460px`).
- O botão de alternar o leitor e o botão **Maximizar / Restaurar** ficam no `SessionHeader` (ao lado do botão de fechar a sessão e do botão do inspetor direito) e também no cabeçalho do próprio `FileViewerPane`.
- Quando maximizado:
  - `.session-panes` e `SessionDetails` ficam ocultos temporariamente (`display: none`).
  - `FileViewerPane` ocupa `100%` da largura de `.session-stage`.
  - Clicar novamente em **Restaurar** ou pressionar `Esc` (quando o foco está dentro do leitor e não há busca interna aberta) restaura a visualização dividida.

### 2.2 Estado do Leitor (`apps/desktop/src/renderer/file-viewer-state.ts`)

Módulo puro com tipos e redutor testáveis:

- `open`: booleano indicando visibilidade do painel.
- `maximized`: booleano indicando modo tela cheia dentro de `.session-stage`.
- `widthPx`: largura configurada do painel.
- `tabs`: lista ordenada de abas abertas (`resolvedPath`, `title`, `source`, `projectId`, `sessionId`, `revision`).
- `activePath`: caminho da aba selecionada atualmente.
- Operações:
  - `openTab`: ativa aba existente pelo `resolvedPath` (incrementando `revision` para recarregar do disco) ou cria nova aba e abre o painel.
  - `closeTab`: fecha a aba e seleciona a aba adjacente; se nenhuma restar, mantém o painel aberto em estado vazio com zona de drop/abertura ou fecha conforme ação do usuário.
  - `toggleOpen`, `toggleMaximized`, `setWidthPx`.

## 3. Gatilhos de Abertura

1. **Respostas do LLM (`Markdown.tsx`)**
   - `Markdown` recebe callback opcional `onOpenFile?: (path: string) => void`.
   - Cliques em links `<a>` cujo `href` não usa `http:`, `https:` ou `mailto:` são interceptados para chamar `onOpenFile` com o caminho normalizado (removendo prefixo `file://` e âncora `#L10` quando presente).
   - Código inline (`` `caminho/arquivo.ext` ``) reconhecido como caminho de arquivo plausível (com extensão conhecida ou barra de diretório) recebe estilo clicável discreto quando `onOpenFile` está presente, abrindo o arquivo no painel ao clicar.
   - Links `http://` e `https://` continuam abrindo no navegador externo.

2. **Cards de Ferramentas (`ToolCard.tsx`)**
   - `EditToolCard` (criação e edição de arquivos) e `LookupToolCard` (`category === 'read'`) recebem botão/clique no caminho do arquivo para abrir o arquivo completo no `FileViewerPane`, mantendo a expansão do diff/leitura inline inalterada.

3. **Aba Alterações (`SessionDetails.tsx`)**
   - Cada item em `session-git-list` recebe um botão de ícone **Abrir no leitor** ao lado do botão de reverter, mantendo o clique principal para abrir o modal de diff (`SessionDiffModal`).

4. **Drag-and-Drop, Seletor e Paleta de Comandos**
   - `FileViewerPane` possui zona de drag-and-drop para soltar arquivos do sistema operacional (`window.inova.getPathForFile(file)`).
   - Botão **Abrir arquivo** no cabeçalho/estado vazio do leitor invoca `window.inova.pickViewerFiles()`.
   - `CommandPaletteModal` adiciona ações para alternar o painel leitor, maximizar/restaurar e abrir arquivo do disco.

## 4. Motor de Leitura por Formato

### 4.1 Destaque Compartilhado (`apps/desktop/src/renderer/shiki-highlight.ts`)

Extrai o `HighlighterCore` e cache LRU de `Markdown.tsx` para um módulo compartilhado, adicionando suporte extra para extensões comuns de código (`jsonc`, `graphql`, `prisma`, `ini`, `csv`, `xml`, `svg`, etc.) e preservando fallback em texto plano.

### 4.2 Renderizadores no `FileViewerPane`

| Tipo | Extensões / Condição | Visualização |
| :--- | :--- | :--- |
| **Código e Texto** | Arquivos UTF-8 sem bytes nulos | Números de linha, destaque `shiki`, alternância de quebra de linha, copiar tudo, busca interna (`⌘F`/`Ctrl+F`) com contagem e navegação próximo/anterior. |
| **Markdown** | `.md`, `.markdown`, `.mdx` | Alternância **Preview** (via `Markdown.tsx`) / **Código-fonte**. |
| **HTML (Browser)** | `.html`, `.htm` | Barra estilo navegador (caminho, **Recarregar**, alternância **Browser / Código-fonte**, **Abrir no navegador externo**) + `<iframe sandbox="allow-scripts allow-forms allow-popups">` carregando URL `inova-preview://`. |
| **Planilhas** | `.xls`, `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv` | Seletor de abas da planilha, cabeçalho de colunas (`A`, `B`, `C`...), índice de linha, busca/filtro de linhas e cópia de célula/CSV. `.csv`/`.tsv` usam parser próprio; `.xls`/`.xlsx`/`.xlsm`/`.ods` usam biblioteca `xlsx` (SheetJS) no processo principal (dependência aprovada). |
| **Imagens** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp` | Preview centralizado via `inova-preview://` com controles de zoom (`-`, `+`, `Ajustar`, `100%`) e fundo neutro para transparência. `.svg` inclui alternância **Preview / Código-fonte**. |
| **PDF** | `.pdf` | `<iframe src="inova-preview://...">` com leitor PDF nativo do Chromium e botão **Abrir no aplicativo padrão**. |
| **Binário / Grande** | Bytes nulos ou acima do limite (`2 MB` texto / `20 MB` planilha) | Cartão de metadados (caminho, tipo, tamanho) e botão **Abrir no aplicativo padrão**. |

## 5. Segurança, IPC e Protocolo `inova-preview://`

### 5.1 Contratos IPC (`apps/desktop/src/shared/api.ts`, `preload/index.ts`, `main/ipc.ts`, `main/handlers.ts`)

Novos métodos expostos em `window.inova`:

- `readFilePreview(input: { path: string; projectId?: string; sessionId?: string; source: 'project' | 'user-drop' | 'picker' }): Promise<Result<FilePreview>>`
- `pickViewerFiles(): Promise<Result<string[]>>`
- `openFilePath(input: { path: string; projectId?: string; sessionId?: string; source: 'project' | 'user-drop' | 'picker' }): Promise<Result<null>>` (valida o caminho com as mesmas regras de origem antes de chamar `shell.openPath` ou `shell.openExternal`)

Regras de validação no processo principal (`handlers.ts` + `validation.ts`):

- **Origem `project`:** Exige `projectId` válido, resolve caminhos relativos contra `effectiveCwd(session, project)` (worktree ativa ou diretório do projeto) e valida com `realpath` que o alvo está dentro de uma raiz autorizada (`isInsideRoot`). Impede que links ou textos gerados pelo LLM leiam arquivos fora do projeto.
- **Origem `picker`:** Caminhos selecionados por `dialog.showOpenDialog` são registrados em um conjunto de arquivos externos autorizados na sessão do app antes de retornar ao renderer.
- **Origem `user-drop`:** Aceita caminhos absolutos enviados exclusivamente por ação de drag-and-drop do usuário, validando via `stat` que o alvo é um arquivo regular legível.
- **Limites de leitura:** Textos acima de `2 MB` retornam estado `too-large` com tamanho e opção de abertura externa; planilhas limitam leitura segura em `20 MB` e cap de células/linhas por aba (`10.000` linhas por aba na tabela, exibindo indicador quando truncado).

### 5.2 Protocolo Isolado `inova-preview://` (`apps/desktop/src/main/preview-protocol.ts`, `main/index.ts`, `renderer/index.html`)

- Registrado com `protocol.registerSchemesAsPrivileged` antes de `app.whenReady()` (`standard: true`, `secure: true`, `supportFetchAPI: true`).
- Cada diretório autorizado (raiz do projeto/worktree ou diretório pai de arquivo aberto por `picker`/`user-drop`) recebe um token aleatório em memória (`inova-preview://view/<token>/<caminho-relativo>`).
- Isso permite que um `.html` carregue CSS, JS e imagens relativas da sua própria pasta, bloqueando travessias (`../`) fora da raiz associada ao token via `realpath` + `isInsideRoot`.
- O `<iframe sandbox="allow-scripts allow-forms allow-popups">` omite `allow-same-origin`, garantindo isolamento total contra acesso ao DOM do app e a `window.inova`.
- O CSP em `apps/desktop/src/renderer/index.html` passa a permitir `frame-src 'self' inova-preview:` e `img-src 'self' data: inova-preview:`.

## 6. Tratamento de Erros e Verificação

### 6.1 Erros Esperados

- **Arquivo inexistente, movido ou diretório:** Exibe mensagem descritiva com botão **Recarregar** e botão **Fechar aba**.
- **Acesso negado (fora do projeto via clique de chat):** Retorna erro claro informando que o arquivo está fora da pasta do projeto e orienta abrir manualmente pelo botão/drag-and-drop.
- **Planilha vazia ou inválida:** Exibe erro legível e botão **Abrir no aplicativo padrão**.

### 6.2 Testes (`vitest`)

- `apps/desktop/test/file-viewer-state.test.ts`: abertura, deduplicação de abas, fechamento, maximização/restauração e redimensionamento.
- `apps/desktop/test/file-preview.test.ts`: detecção de tipos, parser CSV/TSV, leitura XLS/XLSX com `xlsx`, bloqueio de path traversal, limites de tamanho e registro de tokens do protocolo `inova-preview://`.
- `apps/desktop/test/markdown-file-links.test.ts`: detecção/normalização de links e caminhos inline em Markdown.
- Atualização de `apps/desktop/test/ipc.test.ts`, `apps/desktop/test/handlers.test.ts` e `apps/desktop/test/preload.test.ts` para os novos canais IPC.
- Verificação final obrigatória: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` e `pnpm run format:check`.
