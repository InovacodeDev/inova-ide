# Inova IDE: Execução Paralela Comparativa e Perfil Unificado de MCPs e Regras

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Problema e escopo

O usuário frequentemente quer testar dois provedores na mesma tarefa (por exemplo, Claude vs Codex ou Claude vs Gemini) e comparar os diffs gerados sem conflito de arquivos. Além disso, cada conta isolada mantém seu próprio diretório (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HOME`, `XDG_DATA_HOME`), obrigando o usuário a reconfigurar servidores MCP e regras manualmente em cada CLI.

Este subprojeto entrega:

1. **Execução paralela comparativa**: enviar um mesmo prompt para dois provedores/contas em worktrees isolados e comparar os diffs lado a lado.
2. **Perfil unificado de MCPs e instruções**: sincronizar servidores MCP e arquivos de regras do projeto entre Claude, Codex e Gemini (e demais provedores suportados) sem duplicação manual.

## 1. Execução paralela comparativa (`CompareView`)

### Modelo de dados (`src/core/types.ts` e `apps/desktop/src/shared/api.ts`)

Adicionar em `Session`:

- `comparisonGroupId?: string | null` (mesmo UUID nas duas sessões geradas juntas).
- `comparisonRole?: 'left' | 'right' | null`.

### Fluxo de execução

1. **Disparo (`startComparison`)**:
   - Na tela do projeto ou no compositor, o usuário aciona **"Comparar provedores"**, digita o prompt e escolhe Provedor/Conta A e Provedor/Conta B (além de modelo, esforço e modo de cada lado).
   - O processo main valida que o projeto é um repositório Git limpo ou captura o `HEAD` atual (`baseCommit`), cria duas sessões com `createSessionWorktree` apontando para o mesmo `baseCommit` (branches `inova/cmp-<group>-a` e `inova/cmp-<group>-b`) e envia o mesmo prompt em paralelo para ambas.
2. **Visualização lado a lado (`CompareView.tsx`)**:
   - Abre uma aba de comparação vinculada ao `comparisonGroupId`.
   - Exibe duas colunas sincronizadas: stream de resposta/ferramentas de cada provedor, tempo de execução, custo (quando fornecido pela API) e status da verificação pós-turno.
   - Aba **"Diff lado a lado"**: chama `getComparisonDiff({ groupId })`, que calcula `git diff <baseCommit>` (incluindo arquivos não rastreados filtrados via índice temporário) nos dois worktrees e renderiza lista de arquivos alterados com diff lado a lado por arquivo.
3. **Resolução (`resolveComparison`)**:
   - Botão **"Aplicar vencedor (A ou B)"**: aplica o diff do worktree escolhido sobre o diretório principal do projeto (verificando antes se o repo principal não tem conflito), marca a comparação como concluída e oferece remover os dois worktrees temporários (ou manter a sessão vencedora ativa).

## 2. Perfil unificado de MCPs e instruções (`src/core/profile-sync.ts`)

### Fonte canônica única (sem formato proprietário complexo)

O projeto usa preferencialmente o padrão já adotado pelo ecossistema:

- **Servidores MCP do projeto**: lê `.mcp.json` na raiz do projeto (formato padrão `{ "mcpServers": { ... } }` para `stdio` e `http`/`sse`) como fonte primária; se inexistente, permite importar de uma das contas/provedores configurados.
- **Instruções do projeto**: lê `AGENTS.md` (padrão aberto adotado por Codex/agentes) ou `CLAUDE.md` / `GEMINI.md` na raiz do projeto, conforme escolha do usuário na tela de perfil.

### Adaptadores por provedor

Cada provedor recebe os dados da fonte canônica no formato nativo da sua CLI/pasta isolada:

| Provedor | Destino dos MCPs | Mecanismo de escrita / CLI | Arquivo de regras no projeto |
| --- | --- | --- | --- |
| `claude` | `<CLAUDE_CONFIG_DIR>/.claude.json` ou `.mcp.json` do projeto | `claude mcp add-json` (ou gravação atômica em `.claude.json` sob `CLAUDE_CONFIG_DIR`) | `CLAUDE.md` |
| `codex` | `<CODEX_HOME>/config.toml` | Atualiza apenas a seção `[mcp_servers.<nome>]` preservando demais chaves (como `cli_auth_credentials_store`) | `AGENTS.md` |
| `gemini` (`agy`) | `<homeDir>/.gemini/...` gerenciado pela CLI | Executa `agy mcp add` / `agy mcp remove` com `HOME=<homeDir>` para stdio (`-t stdio -e ...`) e http (`-t http -H ...`) | `GEMINI.md` |
| `opencode` | `<projectPath>/opencode.json` (bloco `mcp`) | Mescla bloco `mcp` preservando `agents` e demais chaves | `AGENTS.md` |
| `qwen` | `<homeDir>/.qwen/settings.json` | Mescla chave `mcpServers` | `AGENTS.md` / `QWEN.md` |

Tratamento de provedores sem suporte padronizado ou campos incompatíveis:

- Se um servidor MCP usar recurso não suportado por um destino (ex.: `oauth` interativo no Codex ou header dinâmico em CLI que só aceita `stdio`), o relatório de pré-visualização marca o item como `incompatible` com motivo explícito e pula sem quebrar o restante.
- Valores de variáveis de ambiente e headers nunca são gravados em logs nem exibidos em claro por padrão na UI de resumo (mascarados com opção de revelar).

### Fluxo seguro com pré-visualização (`previewProfileSync` / `applyProfileSync`)

1. **Pré-visualização (`previewProfileSync`)**:
   - Lê os servidores MCP e arquivos de regras atuais da fonte canônica e compara com cada conta vinculada ao projeto (ou contas selecionadas).
   - Retorna plano detalhado por conta/arquivo: `create`, `update`, `unchanged`, `conflict` ou `incompatible`, com diff textual antes/depois para arquivos de texto (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `config.toml`).
2. **Aplicação (`applyProfileSync`)**:
   - Exige confirmação explícita do usuário na UI para itens marcados como `update` ou `conflict`.
   - Antes de alterar qualquer arquivo de configuração ou regra, salva backup com timestamp em `<inovaRoot>/backups/profile-sync/<timestamp>/`.
   - Para `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`, oferece opção de **cópia sincronizada** ou **symlink** (quando o SO suportar e não houver divergência prévia).

## Plano de testes

- `src/core/profile-sync.test.ts`:
  - Leitura de `.mcp.json`, adaptação para `[mcp_servers.*]` em TOML do Codex preservando `cli_auth_credentials_store`, bloco `mcp` do OpenCode preservando outras chaves, geração de args para `agy mcp add` e `claude mcp add-json`.
  - Detecção de conflitos, itens incompatíveis, criação de backup antes de sobrescrever e mascaramento de segredos na pré-visualização.
- `src/core/git-compare.test.ts`:
  - Criação de dois worktrees a partir do mesmo `baseCommit`, coleta de diff por arquivo e aplicação do vencedor sem corromper o repo principal.
- `apps/desktop/test/handlers.test.ts`, `validation.test.ts`, `ipc.test.ts`, `preload.test.ts`:
  - Canais `startComparison`, `getComparisonDiff`, `resolveComparison`, `previewProfileSync` e `applyProfileSync`.
