# Painel Lateral de Leitura de Arquivos e Preview HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar um painel lateral redimensionável e maximizável estilo VS Code no `@inova/desktop` para abrir arquivos gerados, editados, citados pelo LLM ou soltos/selecionados pelo usuário, com renderizadores para código, Markdown, HTML em navegador embutido, planilhas (`XLS`/`XLSX`/`CSV`/`TSV`), imagens, PDF e fallback binário.

**Architecture:** O painel `FileViewerPane` é montado em `.session-stage` entre `.session-panes` e `SessionDetails`, controlado por estado puro de abas/largura/maximização e alimentado por IPC validado no processo principal (`readFilePreview`, `pickViewerFiles`, `openFilePath`). Arquivos HTML, imagens e PDFs são servidos por um protocolo isolado `inova-preview://` mapeado por tokens em memória, permitindo ativos relativos locais sem expor `window.inova` nem APIs Node.

**Tech Stack:** Electron 45, React 19, TypeScript 6, Shiki 4, `react-markdown` + `remark-gfm`, `pulsoicon-react`, `xlsx` (SheetJS), Vitest 5.

**Spec:** [2026-11-16-file-viewer-side-panel-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-16-file-viewer-side-panel-design.md)

## Global Constraints

- Todo texto voltado ao usuário na interface usa Português (`pt-BR`) com paridade de chaves e placeholders em `en-US` validada por `apps/desktop/test/i18n.test.ts`.
- Controles, abas e botões mantêm rótulo em linha única (`white-space: nowrap`) e respeitam tokens CSS de tema claro e escuro (`tokens.css`).
- TypeScript em strict mode sem `any` explícito, sem comentários redundantes (apenas `REGEX:`, `ALGORITHM:`, `NOTE:` quando necessário) e funções com no máximo 3 parâmetros posicionais (usar objeto para mais parâmetros).
- Gerenciador de pacotes obrigatório: `pnpm`. Única nova dependência autorizada: `xlsx` em `apps/desktop`.
- Não usar `setState` síncrono direto dentro de `useEffect` (usar `queueMicrotask` se necessário).

## Review Focus

- Cliques em caminhos com traversal (`../../../etc/passwd`) ou symlink escapando da raiz do projeto via `source: 'project'` devem ser bloqueados com erro de acesso negado — testado na Task 1 (`file-preview.test.ts`).
- Requisições `inova-preview://` para ativos relativos válidos devem resolver com MIME correto, enquanto `../` escapando do token da raiz deve retornar `null`/403 — testado na Task 2 (`preview-protocol.test.ts`).
- Planilhas CSV com vírgulas/quebras entre aspas, workbooks vazios e planilhas com mais de `10.000` linhas devem parsear sem quebrar e truncar com sinalização `truncated: true` — testado na Task 1 (`file-preview.test.ts`).
- Links Markdown como `[a](file:///repo/app.ts#L12)` e código inline `` `src/app.ts:42` `` devem normalizar âncoras/prefixos, enquanto `https://...` e `#ancora` não devem abrir no leitor — testado na Task 3 (`markdown-file-links.test.ts`).
- Reabrir um arquivo já aberto em aba deve reutilizar a aba e incrementar `revision` para recarregar do disco, e fechar abas ou restaurar de maximizado deve manter o estado consistente — testado na Task 3 (`file-viewer-state.test.ts`).

---

### Task 1: Shared File Preview Types, Validation, and File/Spreadsheet Reader

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/shared/api.ts:185-457`
- Modify: `apps/desktop/src/main/validation.ts:62-120`
- Create: `apps/desktop/src/main/file-preview.ts`
- Test: `apps/desktop/test/file-preview.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`, `xlsx`
- Produces:
  - In `apps/desktop/src/shared/api.ts`: `FilePreviewSource`, `FilePreviewKind`, `SpreadsheetSheet`, `FilePreview`, `ReadFilePreviewInput`, `OpenFilePathInput`, `CHANNELS.readFilePreview`, `CHANNELS.pickViewerFiles`, `CHANNELS.openFilePath`, and methods on `InovaApi`
  - In `apps/desktop/src/main/validation.ts`: `parseReadFilePreview(input: unknown): ReadFilePreviewInput | undefined`, `parseOpenFilePath(input: unknown): OpenFilePathInput | undefined`
  - In `apps/desktop/src/main/file-preview.ts`: `parseCsvRows(input: { text: string; delimiter: string }): string[][]`, `parseWorkbookSheets(buffer: Uint8Array): SpreadsheetSheet[]`, `detectFileKind(input: { filePath: string; sample: Uint8Array }): FilePreviewKind`, `readFilePreviewContent(input: ReadFilePreviewContentInput): Promise<Result<FilePreview>>`

- [ ] **Step 1: Install `xlsx` in `@inova/desktop`**

Run: `pnpm --filter @inova/desktop add xlsx`
Expected: `xlsx` added to `dependencies` in `apps/desktop/package.json` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing test in `apps/desktop/test/file-preview.test.ts`**

Create `apps/desktop/test/file-preview.test.ts` covering:
- `parseCsvRows`: parses quoted commas, escaped quotes `""`, and embedded newlines `"a,b\nc"`.
- `parseWorkbookSheets`: reads a real buffer generated with `xlsx.utils.book_new()` / `xlsx.write(..., { type: 'buffer', bookType: 'xlsx' })` with multiple sheets, returns `truncated: true` when rows exceed `10_000`, and throws/fails cleanly on empty workbook.
- `detectFileKind`: maps `.html`/`.htm` -> `'html'`, `.md`/`.mdx` -> `'markdown'`, `.xls`/`.xlsx`/`.xlsm`/`.ods`/`.csv`/`.tsv` -> `'spreadsheet'`, `.png`/`.svg` -> `'image'`, `.pdf` -> `'pdf'`, text without `\0` -> `'text'`, sample with `\0` -> `'binary'`.
- `readFilePreviewContent`:
  - Resolves relative path against `cwd` when `source: 'project'`, returning `'text'`/`'html'`/`'spreadsheet'`.
  - Rejects `../outside.txt` and symlinks pointing outside `allowedRoots` when `source: 'project'`.
  - Requires `allowExternal` match when `source: 'picker'`, and accepts existing regular file when `source: 'user-drop'`.
  - Returns `kind: 'too-large'` for text files > `2 * 1024 * 1024` bytes.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-preview.test.ts`
Expected: FAIL because `src/main/file-preview.ts` and shared types do not exist yet.

- [ ] **Step 4: Add shared types and channels to `apps/desktop/src/shared/api.ts`**

Add `FilePreviewSource = 'project' | 'user-drop' | 'picker'`, `FilePreviewKind`, `SpreadsheetSheet` (`{ name: string; columns: string[]; rows: string[][]; totalRows: number; truncated: boolean }`), `FilePreview` discriminated union (`resolvedPath`, `name`, `extension`, `sizeBytes`, `mtimeMs`, plus kind-specific fields `content` for `'text' | 'markdown'`, `content` + `previewUrl` for `'html'`, `previewUrl` + optional `content` for `'image'`/`'svg'`, `previewUrl` for `'pdf'`, `sheets` for `'spreadsheet'`, or `reason` for `'binary' | 'too-large'`), `ReadFilePreviewInput`, `OpenFilePathInput`, `CHANNELS` entries (`readFilePreview`, `pickViewerFiles`, `openFilePath`), and `InovaApi` methods.

- [ ] **Step 5: Add `parseReadFilePreview` and `parseOpenFilePath` in `apps/desktop/src/main/validation.ts`**

Validate `path` (bounded non-empty string without `\0`, max 4096 chars; must be absolute when `source !== 'project'`), optional `projectId` / `sessionId` (`isSafeId`), and `source` (`'project' | 'user-drop' | 'picker'`).

- [ ] **Step 6: Implement `apps/desktop/src/main/file-preview.ts`**

Implement `parseCsvRows`, `parseWorkbookSheets`, `detectFileKind`, and `readFilePreviewContent` (using `realpath`, `isInsideRoot`, `MAX_TEXT_BYTES = 2 * 1024 * 1024`, `MAX_SPREADSHEET_BYTES = 20 * 1024 * 1024`, `MAX_SHEET_ROWS = 10_000`, `MAX_SHEET_COLS = 100`, and `createPreviewUrl(dirPath, fileName)` callback for HTML/image/PDF URLs).

- [ ] **Step 7: Run tests and typecheck to verify Task 1 passes**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-preview.test.ts && pnpm --filter @inova/desktop run typecheck`
Expected: PASS on all assertions in `test/file-preview.test.ts` and zero TS errors.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/shared/api.ts apps/desktop/src/main/validation.ts apps/desktop/src/main/file-preview.ts apps/desktop/test/file-preview.test.ts
git commit -m "feat(desktop): add file preview types, validation, and spreadsheet/file reader"
```

---

### Task 2: Isolated `inova-preview://` Protocol & Main/Preload IPC Wiring

**Files:**
- Create: `apps/desktop/src/main/preview-protocol.ts`
- Modify: `apps/desktop/src/main/handlers.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/main/index.ts:1-130,355-395`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/index.html`
- Test: `apps/desktop/test/preview-protocol.test.ts`
- Modify: `apps/desktop/test/ipc.test.ts`
- Modify: `apps/desktop/test/preload.test.ts`
- Modify: `apps/desktop/test/handlers.test.ts`

**Interfaces:**
- Consumes: `readFilePreviewContent`, `parseReadFilePreview`, `parseOpenFilePath` from Task 1; `CHANNELS`, `InovaApi`
- Produces:
  - `createPreviewRegistry()`: `{ authorizeRoot(dirPath: string): Promise<string>; buildUrl(input: { rootDir: string; filePath: string }): Promise<string>; resolveRequest(url: string): Promise<{ filePath: string; mimeType: string } | null> }`
  - `handlers.readFilePreview`, `handlers.pickViewerFiles`, `handlers.openFilePath`
  - `window.inova.readFilePreview`, `window.inova.pickViewerFiles`, `window.inova.openFilePath`

- [ ] **Step 1: Write the failing test in `apps/desktop/test/preview-protocol.test.ts`**

Test `createPreviewRegistry`:
- `buildUrl` generates `inova-preview://view/<token>/<relativePosixPath>` and reuses the same token for the same canonical root directory.
- `resolveRequest` resolves relative asset paths inside the root (e.g., `chart.js`, `assets/logo.svg`) with exact `mimeType` (`text/javascript`, `image/svg+xml`, `text/html`, `application/pdf`, `text/css`).
- `resolveRequest` returns `null` for unknown tokens, `../outside.txt` traversal, or symlinks escaping the root.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @inova/desktop exec vitest run test/preview-protocol.test.ts`
Expected: FAIL because `src/main/preview-protocol.ts` does not exist.

- [ ] **Step 3: Implement `apps/desktop/src/main/preview-protocol.ts`**

Implement `createPreviewRegistry` using `crypto.randomUUID()` tokens, `realpath` normalization, `isInsideRoot`, and an extension-to-MIME lookup table.

- [ ] **Step 4: Wire handlers, IPC, preload, protocol registration, and CSP**

- In `apps/desktop/src/main/handlers.ts`: accept optional `pickViewerFiles` and `previewRegistry` in deps; maintain `pickerAllowlist = new Set<string>()`; implement `readFilePreview`, `pickViewerFiles`, and `openFilePath` (checking the same origin rules before invoking `deps.openPath` / `deps.openExternal` for HTML or files).
- In `apps/desktop/src/main/ipc.ts`: register `CHANNELS.readFilePreview`, `CHANNELS.pickViewerFiles`, `CHANNELS.openFilePath`.
- In `apps/desktop/src/preload/index.ts`: expose `readFilePreview`, `pickViewerFiles`, `openFilePath`.
- In `apps/desktop/src/main/index.ts`: call `protocol.registerSchemesAsPrivileged([{ scheme: 'inova-preview', privileges: { standard: true, secure: true, supportFetchAPI: true } }])` before `app.whenReady()`; register `protocol.handle('inova-preview', ...)` returning `Response` from disk bytes or `403`/`404`; pass `pickViewerFiles` (via `dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })`) and `previewRegistry` into `createHandlers`.
- In `apps/desktop/src/renderer/index.html`: update CSP to `default-src 'self'; frame-src 'self' inova-preview:; img-src 'self' data: inova-preview:; style-src 'self' 'unsafe-inline'`.

- [ ] **Step 5: Update `apps/desktop/test/ipc.test.ts`, `apps/desktop/test/preload.test.ts`, and `apps/desktop/test/handlers.test.ts`**

Add tests for `readFilePreview`, `pickViewerFiles`, and `openFilePath` channel routing, untrusted sender rejection, and origin enforcement in `handlers.test.ts`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @inova/desktop exec vitest run test/preview-protocol.test.ts test/ipc.test.ts test/preload.test.ts test/handlers.test.ts && pnpm --filter @inova/desktop run typecheck`
Expected: PASS on all four test files and zero TS errors.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/desktop/src/main/preview-protocol.ts apps/desktop/src/main/handlers.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/index.html apps/desktop/test/preview-protocol.test.ts apps/desktop/test/ipc.test.ts apps/desktop/test/preload.test.ts apps/desktop/test/handlers.test.ts
git commit -m "feat(desktop): add inova-preview protocol and file viewer IPC channels"
```

---

### Task 3: Pure File Viewer State & Markdown File Link Resolution

**Files:**
- Create: `apps/desktop/src/renderer/file-viewer-state.ts`
- Create: `apps/desktop/src/renderer/markdown-file-links.ts`
- Test: `apps/desktop/test/file-viewer-state.test.ts`
- Test: `apps/desktop/test/markdown-file-links.test.ts`

**Interfaces:**
- Consumes: `FilePreviewSource` from `../shared/api`
- Produces:
  - `file-viewer-state.ts`: `VIEWER_MIN_WIDTH = 320`, `VIEWER_DEFAULT_WIDTH = 460`, `FileViewerTab`, `FileViewerState`, `initialFileViewerState`, `clampViewerWidth({ width: number; containerWidth: number }): number`, `fileViewerReducer(state: FileViewerState, action: FileViewerAction): FileViewerState`
  - `markdown-file-links.ts`: `parseLocalFileHref(href: string): { path: string; line: number | null } | null`, `parseInlineFileCode(text: string): { path: string; line: number | null } | null`

- [ ] **Step 1: Write failing tests in `apps/desktop/test/file-viewer-state.test.ts` and `apps/desktop/test/markdown-file-links.test.ts`**

- `file-viewer-state.test.ts`:
  - `openTab` opens panel (`open: true`), creates tab, sets `activePath`.
  - `openTab` for same `resolvedPath` activates existing tab and increments `revision` without duplicating.
  - `closeTab` selects adjacent tab; closing the last tab clears `activePath` and sets `maximized: false`.
  - `toggleMaximized` opens panel when maximizing from closed state and restores cleanly; `setWidthPx` clamps to `[320, Math.floor(containerWidth * 0.7)]`.
- `markdown-file-links.test.ts`:
  - `parseLocalFileHref`: returns `{ path: '/repo/src/app.ts', line: 12 }` for `file:///repo/src/app.ts#L12`, `{ path: 'car_comparison.html', line: null }` for `car_comparison.html`, and `null` for `https://example.com`, `http://localhost:3000`, `mailto:a@b.com`, `#heading`.
  - `parseInlineFileCode`: returns `{ path: 'src/core/files.ts', line: 42 }` for `src/core/files.ts:42` or `report.xlsx`, and `null` for plain words (`npm test`, `useState`, `v0.9.2`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-viewer-state.test.ts test/markdown-file-links.test.ts`
Expected: FAIL because modules do not exist yet.

- [ ] **Step 3: Implement `file-viewer-state.ts` and `markdown-file-links.ts`**

Keep both modules pure TypeScript with small helper functions and explicit regex comments (`// REGEX: ...`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-viewer-state.test.ts test/markdown-file-links.test.ts && pnpm --filter @inova/desktop run typecheck`
Expected: PASS on all assertions.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/desktop/src/renderer/file-viewer-state.ts apps/desktop/src/renderer/markdown-file-links.ts apps/desktop/test/file-viewer-state.test.ts apps/desktop/test/markdown-file-links.test.ts
git commit -m "feat(desktop): add file viewer state reducer and markdown path parser"
```

---

### Task 4: Shared Shiki Highlighter, Icons, Markdown Links, and i18n

**Files:**
- Create: `apps/desktop/src/renderer/shiki-highlight.ts`
- Modify: `apps/desktop/src/renderer/Markdown.tsx`
- Modify: `apps/desktop/src/renderer/icons.tsx`
- Modify: `apps/desktop/src/renderer/i18n/workspace.ts`
- Test: `apps/desktop/test/shiki-highlight.test.ts`

**Interfaces:**
- Consumes: `parseLocalFileHref`, `parseInlineFileCode` from Task 3
- Produces:
  - `shiki-highlight.ts`: `canonicalLang(lang: string): string | null`, `languageForFilePath(filePath: string): string`, `highlightCode(input: { code: string; lang: string }): Promise<string | null>`
  - `Markdown.tsx`: `MarkdownProps` extended with `onOpenFile?: (path: string) => void`
  - `icons.tsx`: `MaximizeIcon`, `MinimizeIcon`, `GlobeIcon`, `TableIcon`, `TextWrapIcon`, `FileCodeIcon`, `FileSpreadsheetIcon`, `ZoomInIcon`, `ZoomOutIcon`, `ZoomResetIcon`, `FolderOpenIcon`, `ArrowUpIcon`, `ArrowDownIcon`
  - `i18n/workspace.ts`: `fileViewer.*` and `sessionHeader.toggleFileViewer` / `sessionHeader.maximizeFileViewer` / `sessionHeader.restoreFileViewer` keys in both `WORKSPACE_PT_BR` and `WORKSPACE_EN_US`

- [ ] **Step 1: Write failing test in `apps/desktop/test/shiki-highlight.test.ts`**

Test `canonicalLang` aliases (`ts`, `py`, `yml`, `htm`, `md`) and `languageForFilePath` (`foo.tsx` -> `'tsx'`, `Dockerfile` -> `'dockerfile'`, `report.csv` -> `'csv'`, `unknown.xyz` -> `'text'`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @inova/desktop exec vitest run test/shiki-highlight.test.ts`
Expected: FAIL because `src/renderer/shiki-highlight.ts` does not exist.

- [ ] **Step 3: Extract `shiki-highlight.ts` and update `Markdown.tsx`**

Move `LANG_LOADERS`, `LANG_ALIASES`, `canonicalLang`, `getHighlighter`, `htmlCache`, and `highlight` from `Markdown.tsx` into `shiki-highlight.ts`, add `languageForFilePath`, and update `Markdown.tsx` to import `highlightCode`. In `Markdown.tsx`, intercept local `a` clicks via `parseLocalFileHref` and render clickable button/span for inline `code` tokens matching `parseInlineFileCode` when `onOpenFile` is provided.

- [ ] **Step 4: Add icons to `icons.tsx` and i18n keys to `i18n/workspace.ts`**

Import verified `pulsoicon-react/icons/*` modules (`maximize`, `minimize`, `globe`, `table`, `text-wrap`, `file-code`, `file-spreadsheet`, `zoom-in`, `zoom-out`, `zoom-reset`, `folder-open`, `arrow-up`, `arrow-down`). Add matching `pt-BR` and `en-US` keys in `i18n/workspace.ts`.

- [ ] **Step 5: Run tests (`shiki-highlight`, `i18n`, `rich-markdown`) and typecheck**

Run: `pnpm --filter @inova/desktop exec vitest run test/shiki-highlight.test.ts test/i18n.test.ts test/rich-markdown.test.ts && pnpm --filter @inova/desktop run typecheck`
Expected: PASS on all tests, including full `pt-BR`/`en-US` key and placeholder parity.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/desktop/src/renderer/shiki-highlight.ts apps/desktop/src/renderer/Markdown.tsx apps/desktop/src/renderer/icons.tsx apps/desktop/src/renderer/i18n/workspace.ts apps/desktop/test/shiki-highlight.test.ts
git commit -m "feat(desktop): share shiki highlighter, add file viewer icons, i18n, and markdown file links"
```

---

### Task 5: `FileViewerPane` Component, Format Renderers, and Styling

**Files:**
- Create: `apps/desktop/src/renderer/file-viewer-format.ts`
- Create: `apps/desktop/src/renderer/FileViewerPane.tsx`
- Create: `apps/desktop/src/renderer/file-viewer.css`
- Test: `apps/desktop/test/file-viewer-format.test.ts`

**Interfaces:**
- Consumes: `FilePreview`, `FilePreviewSource` (`../shared/api`), `FileViewerTab` (`./file-viewer-state`), `highlightCode`, `languageForFilePath` (`./shiki-highlight`), `Markdown` (`./Markdown`), `icons.tsx`, `useI18n`
- Produces:
  - `file-viewer-format.ts`: `spreadsheetColumnLabel(index: number): string`, `findTextMatches(input: { text: string; query: string }): number[]`, `filterSheetRows(input: { rows: readonly string[][]; query: string }): { rowIndex: number; cells: string[] }[]`, `formatFileSize(bytes: number): string`, `clampZoom(zoom: number): number`
  - `FileViewerPane.tsx`: `FileViewerPane(props: FileViewerPaneProps)` with tab bar, resize handle, drag-and-drop overlay, search bar, and format renderers (`CodeViewer`, `MarkdownFileViewer`, `HtmlBrowserViewer`, `SpreadsheetViewer`, `ImageViewer`, `PdfViewer`, `FallbackViewer`).

- [ ] **Step 1: Write failing test in `apps/desktop/test/file-viewer-format.test.ts`**

Test:
- `spreadsheetColumnLabel(0)` -> `'A'`, `25` -> `'Z'`, `26` -> `'AA'`.
- `findTextMatches`: case-insensitive line indices matching query, returns `[]` for empty query.
- `filterSheetRows`: filters rows matching query across any cell and preserves 1-based original row index.
- `formatFileSize`: formats `B`, `KB`, `MB`.
- `clampZoom`: clamps between `0.25` and `4`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-viewer-format.test.ts`
Expected: FAIL because `src/renderer/file-viewer-format.ts` does not exist.

- [ ] **Step 3: Implement `file-viewer-format.ts`, `FileViewerPane.tsx`, and `file-viewer.css`**

- Keep sub-renderers small and focused inside `FileViewerPane.tsx` (or separate renderers if > 350 lines).
- `HtmlBrowserViewer` renders a browser bar (path, Reload button incrementing `iframeKey`, Preview/Source toggle, Open in external browser button) and `<iframe sandbox="allow-scripts allow-forms allow-popups" src={previewUrl} title={name} />`.
- `CodeViewer` renders numbered lines, `shiki-highlight` output (with safe fallback when lines/size exceed fast-highlight threshold), word-wrap toggle, internal search (`⌘F`/`Ctrl+F` inside panel), and copy button.
- `SpreadsheetViewer` renders sheet tabs, sticky `A`/`B`/`C` column headers, row numbers, row search filter, and truncation notice when `sheet.truncated` is true.
- Drag-and-drop handler on the panel accepts dropped files (`window.inova.getPathForFile(file)`) and calls `onOpenDroppedFiles(paths)`.
- Resize handle on the left border calls `onResizeWidth(clampViewerWidth(...))`.
- Styles in `file-viewer.css` use only `tokens.css` variables (`--bg`, `--panel`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, etc.) and `white-space: nowrap` on buttons/tabs.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @inova/desktop exec vitest run test/file-viewer-format.test.ts && pnpm --filter @inova/desktop run typecheck`
Expected: PASS on all assertions and zero TS errors.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/desktop/src/renderer/file-viewer-format.ts apps/desktop/src/renderer/FileViewerPane.tsx apps/desktop/src/renderer/file-viewer.css apps/desktop/test/file-viewer-format.test.ts
git commit -m "feat(desktop): implement FileViewerPane with code, markdown, HTML browser, spreadsheet, image, and PDF viewers"
```

---

### Task 6: Integrate Triggers, Maximize Controls, and Shortcuts Across the Workspace

**Files:**
- Modify: `apps/desktop/src/renderer/SessionHeader.tsx`
- Modify: `apps/desktop/src/renderer/ToolCard.tsx`
- Modify: `apps/desktop/src/renderer/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/SessionDetails.tsx`
- Modify: `apps/desktop/src/renderer/command-palette-state.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/session.css`
- Modify: `apps/desktop/src/renderer/chat.css`
- Modify: `apps/desktop/test/command-palette-state.test.ts`

**Interfaces:**
- Consumes: `FileViewerPane`, `fileViewerReducer`, `initialFileViewerState`, `window.inova.readFilePreview`, `window.inova.pickViewerFiles`, `window.inova.openFilePath`
- Produces: Complete end-to-end file viewer workflow in `App.tsx`

- [ ] **Step 1: Update `apps/desktop/test/command-palette-state.test.ts` for new viewer commands**

Write failing test verifying `buildCommandPaletteItems` includes actions to toggle the file viewer and open a file in the viewer when in workspace.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @inova/desktop exec vitest run test/command-palette-state.test.ts`
Expected: FAIL because viewer actions are not yet in `command-palette-state.ts`.

- [ ] **Step 3: Wire `SessionHeader.tsx`, `ToolCard.tsx`, `ChatView.tsx`, `SessionDetails.tsx`, `command-palette-state.ts`, and `App.tsx`**

- `SessionHeader.tsx`: add optional props `fileViewerOpen`, `fileViewerMaximized`, `onToggleFileViewer`, `onToggleFileViewerMaximized`; place the File Viewer toggle button and the Maximize/Restore button right next to the close button (`onClose`).
- `ToolCard.tsx`: accept `onOpenFile?: (path: string) => void`; in `EditToolCard` and `LookupToolCard` (`category === 'read'`), add a clickable file button (`e.stopPropagation()` inside `<summary>`) to open `filePath` / `target` in the viewer.
- `ChatView.tsx`: accept `onOpenFile?: (path: string) => void` and pass it to `Markdown` and `ToolCard`.
- `SessionDetails.tsx`: accept `onOpenFile?: (path: string) => void` and render a small preview icon button on each file row in `session-git-list` (`e.stopPropagation()`).
- `App.tsx`:
  - Manage `fileViewer` reducer state and per-tab loaded `FilePreview` cache/loading/error map keyed by `resolvedPath + '@' + revision`.
  - Provide `openFileInViewer({ path, source, projectId, sessionId })`, `openViewerPicker()`, `openExternalFilePath()`, and `reloadActiveViewerTab()`.
  - Render `<FileViewerPane>` inside `.session-stage`; when `fileViewer.open && fileViewer.maximized`, hide `.session-panes` and `SessionDetails` via `display: none` (preserving chat scroll/DOM state!) so `FileViewerPane` fills 100% of `.session-stage`.
  - Support `Esc` inside `FileViewerPane` to exit maximized mode when no modal is open.
- `session.css` / `chat.css`: style `.session-header` viewer buttons, `.chat-tool-file-btn`, `.md-file-link`, and maximized stage behavior.

- [ ] **Step 4: Run full workspace verification**

Run:
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test`
- `pnpm run format:check`

Expected: All typechecks, ESLint (`--max-warnings 0`), Vitest suites (`src` + `apps/desktop`), and Prettier checks PASS with 0 errors and 0 warnings.

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/desktop/src/renderer/SessionHeader.tsx apps/desktop/src/renderer/ToolCard.tsx apps/desktop/src/renderer/ChatView.tsx apps/desktop/src/renderer/SessionDetails.tsx apps/desktop/src/renderer/command-palette-state.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/session.css apps/desktop/src/renderer/chat.css apps/desktop/test/command-palette-state.test.ts
git commit -m "feat(desktop): integrate file viewer triggers, maximize mode, and command palette actions"
```
