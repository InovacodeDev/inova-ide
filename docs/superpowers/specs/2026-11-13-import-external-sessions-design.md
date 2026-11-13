# Inova IDE: Importar sessões externas

Data: 2026-11-13 · Status: implementado (fase 1) · Branch: `feat/import-sessions` (base: `main`)

## Problema e objetivo

O usuário já conversou com agentes fora do Inova IDE (terminal, Claude Code desktop, Codex CLI). Essas sessões ficam na pasta padrão do CLI (ex.: `~/.claude`), não na pasta isolada da conta do Inova. Hoje o app não as enxerga.

Objetivo: o usuário escolhe um projeto do Inova IDE, vê as sessões externas gravadas para a pasta desse projeto, e importa uma ou mais. A sessão importada aparece na sidebar como sessão normal, mostra o histórico e continua a mesma conversa.

## Onde cada provedor guarda sessões

Verificado nesta máquina em 2026-11-13 (Claude Code 2.1.322, agy 1.5.8, arquivos do Codex em disco).

| Provedor | Local | Formato | Fase |
| --- | --- | --- | --- |
| `claude` | `<CLAUDE_CONFIG_DIR ou ~/.claude>/projects/<cwd com todo caractere fora de [a-zA-Z0-9] trocado por ->/<uuid>.jsonl` | JSONL. Linhas `user`/`assistant` com `message` no formato da API, `cwd`, `timestamp`, `isMeta`, `isSidechain` | 1 (listar, importar e histórico verificados no app; `claude --resume` acha a sessão copiada; turno continuado não verificado: conta de teste sem login) |
| `codex` | `<CODEX_HOME ou ~/.codex>/sessions/AAAA/MM/DD/rollout-<data>-<uuid>.jsonl` | JSONL. Primeira linha `session_meta` com `payload.id` e `payload.cwd`; mensagens em `response_item` com `payload.role` | 1 (descoberta e cópia testadas; retomada não verificada: binário `codex` ausente na máquina) |
| `gemini` (`agy`) | `~/.gemini/antigravity-cli/conversations/<uuid>.db` + índice `conversation_summaries.db` | SQLite por conversa, conteúdo em protobuf | 2 |
| `qwen`, `kimi`, `grok`, `opencode`, `deepseek` | Não confirmado | Não confirmado | 2 |

Motivos da fase 2:

- `agy`: o índice e a conversa são SQLite + protobuf. Ler exige `node:sqlite` (experimental) ou dependência nova, e não está confirmado se copiar só o `.db` da conversa basta para `--conversation <id>` funcionar em outro `HOME`.
- Demais: CLI não instalado nesta máquina. O formato não foi confirmado e o projeto proíbe inventar caminho ou formato.

## Decisões

### 1. Como a sessão fica retomável pela conta do Inova

Cada conta roda com pasta própria (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). O CLI só acha a sessão dentro dessa pasta.

| Opção | Vantagem | Desvantagem |
| --- | --- | --- |
| **A. Copiar o arquivo da conversa para a pasta da conta (escolhida)** | Mantém o isolamento. Mantém o id original. Sem credencial envolvida. O original fica intacto | Duplica o arquivo. As duas cópias divergem depois da importação |
| B. Symlink para o arquivo original | Sem duplicar | Terminal e Inova escrevem no mesmo arquivo; uma conta lê e grava fora da própria pasta |
| C. Retomar com a pasta padrão do usuário | Zero cópia | Usa a credencial do usuário fora da conta isolada. Viola a regra central do app |
| D. Não retomar; só injetar um resumo como `handoffContext` | Funciona entre provedores | Perde o contexto real da conversa |

Regras da opção A:

- Copia só o arquivo `.jsonl` da conversa. Nunca credencial, Keychain, nem `.env`.
- A cópia usa `COPYFILE_EXCL`. Se o destino já existe, o arquivo existente é preservado (não sobrescreve conversa já continuada).
- Origem igual ao destino (pasta padrão é a pasta da conta) é recusada.
- A pasta auxiliar do Claude `<uuid>/` (subagentes, saídas grandes) não é copiada. A retomada não depende dela.

### 2. Modelo de dados

Nenhum tipo novo em `Session`. `createSession` ganha o campo opcional `providerSessionId`. A sessão importada nasce com o id do provedor preenchido, então `decideTurn` já escolhe `resume` no primeiro envio. Sem fluxo paralelo.

### 3. Conta de destino

A sessão só retoma em conta do mesmo provedor. O modal mostra uma conta de destino por provedor (padrão: a conta do projeto, se for do mesmo provedor). Conta diferente da conta do projeto vira `accountIdOverride`. Provedor sem conta no Inova aparece na lista com a importação desabilitada.

### 4. Histórico exibido

A fase 1 converte o arquivo externo em `ChatEvent[]` e grava o transcript do Inova (`<root>/sessions/<id>.jsonl`): mensagens do usuário, texto do assistente e, no Claude, chamadas e resultados de ferramenta (reusa `createChatParser('claude')`). Codex: só texto do usuário e do assistente. Mensagens `isMeta`, `isSidechain` e as que começam com tag de sistema ficam fora.

### 5. Segurança

- O renderer envia só `projectId`, `provider`, `accountId` e ids de sessão. Nenhum caminho.
- Id de sessão externa precisa ser UUID (`isExternalSessionId`). Para o Claude o caminho é montado de `raiz conhecida + nome derivado do path do projeto + id validado`. Para o Codex o id nunca vira caminho: o arquivo é achado por varredura e comparação do `session_meta`.
- Só arquivo regular (`lstat`): symlink é ignorado.
- A sessão só entra na lista se o `cwd` gravado nela for igual ao path do projeto (o nome da pasta do Claude é ambíguo: `/a-b` e `/a/b` colidem).
- Conteúdo importado é dado: só é parseado como JSON e exibido. Nada é executado.

## Fluxo

1. Sidebar: botão "Importar sessões" no cabeçalho do projeto abre `ImportSessionModal`.
2. `listExternalSessions({ projectId })` devolve, por provedor: `id`, `title` (primeira mensagem do usuário), `updatedAt` (mtime), `sizeBytes`, `imported` (já existe sessão do projeto com esse `providerSessionId`).
3. O usuário marca sessões e confirma. `importSessions({ projectId, provider, accountId, sessionIds })` roda por provedor: copia o arquivo, cria a `Session`, grava o transcript.
4. O app recarrega as sessões do projeto e abre a primeira importada.

## Arquivos

- `src/core/session-import.ts` (+ teste): descoberta, validação de id, cópia, conversão para `ChatEvent`.
- `src/core/sessions.ts`: `createSession` aceita `providerSessionId`.
- `apps/desktop/src/shared/api.ts`, `main/validation.ts`, `main/handlers.ts`, `main/ipc.ts`, `preload/index.ts`: canais `listExternalSessions` e `importSessions`.
- `apps/desktop/src/renderer/ImportSessionModal.tsx`, `Sidebar.tsx`, `App.tsx`.

## Limites conhecidos (fase 1)

- Só a pasta padrão do CLI é origem. Sessões de outra conta do Inova não aparecem.
- Só sessões cujo `cwd` é o path do projeto. Sessões criadas em worktree ou subpasta não aparecem.
- Path de projeto muito longo: o Claude encurta o nome da pasta com hash; essas sessões não são encontradas.
- Codex: varredura limitada aos 1000 arquivos `rollout` mais recentes.
- Título vem da primeira mensagem; `custom-title` do Claude é ignorado.
- Atalho global: não incluído. O catálogo de atalhos vive na branch `feat/settings-modal`, ainda não integrada à `main`.

## Fase 2

- `agy`: confirmar se a cópia de `conversations/<id>.db` basta; ler o índice via `node:sqlite` quando o Electron o tiver estável.
- Qwen, Kimi, Grok, OpenCode, DeepSeek: confirmar local e formato com o CLI instalado.
- Importar de outra conta do Inova; importar sessões de worktree.
