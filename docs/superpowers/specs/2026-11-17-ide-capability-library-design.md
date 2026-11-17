# Biblioteca de capacidades da IDE: skills, plugins e conectores

Data: 2026-11-17 · Status: rascunho para aprovação · Frente 1 de 3 (ver também `ide-command-executor-design` e `composer-autoformat-design`)

## Intenção

Hoje, skills, MCP, conectores e plugins vivem dentro de cada conta de provider. O usuário instala o mesmo item em cada conta. Quando troca de provider, perde o item.

O usuário quer que esses itens pertençam à IDE. Qualquer projeto, em qualquer provider, enxerga os mesmos itens.

## Leitura escolhida do pedido (decisão declarada)

"Parte de qualquer projeto e vinculado à IDE" tem duas leituras:

| Leitura | Onde o item mora | Efeito |
| --- | --- | --- |
| **A (escolhida)** | Biblioteca no root da IDE (`<root>/library/`). Vale para todo projeto. | Instala uma vez. Todo projeto e todo provider recebem o item. |
| B | Arquivos dentro de cada projeto (`.mcp.json`, `.claude/skills`). | Vai no git do projeto. Cada projeto repete a instalação. |

Motivo: o pedido diz "vinculado à IDE" e "independente do provider". A leitura A cobre os dois.

O `.mcp.json` do projeto continua válido. Ele já é a fonte canônica de `profile-sync`. Precedência: item do projeto vence item da biblioteca com o mesmo nome.

## Relação com specs anteriores (declaração obrigatória)

Esta spec **revoga** três itens da spec `2026-11-14-account-capabilities-design.md`, só para itens da biblioteca:

1. "Fora do escopo: instalar, desinstalar ou editar a definição de um item". A biblioteca instala e edita.
2. "Fora do escopo: regras por projeto". A biblioteca aceita desligar um item por projeto.
3. "Decisão 5: itens de projeto ficam fora do modal". O modal da conta continua sem itens de projeto. A biblioteca tem tela própria.

Estes itens **continuam valendo**:

- A chave liga/desliga por conta (`Account.disabledCapabilities`) continua. Ela é um interruptor de corte. Item efetivo = ligado na biblioteca **e** ligado no projeto **e** não desligado na conta.
- `applyMode: 'unsupported'` com motivo para o que o provider não suporta. Esta spec não promete paridade.
- Backup antes de gravar, gravação atômica, nunca ler `.env*`, nunca mostrar valor de token, header ou `env`.

`profile-sync` (spec `2026-11-13-parallel-compare-unified-profile-design.md`, seção 2) é o motor. Esta spec o **estende**. Ela não cria um sistema paralelo.

## Regra de credenciais (memória `inova-ide-no-token-handling`)

A IDE só roda binários oficiais. Ela nunca lê, guarda ou envia token OAuth.

- **Conector da IDE** = servidor MCP remoto (`http`/`sse`) cuja autenticação o CLI oficial do provider faz. A IDE não faz OAuth.
- Segredos de MCP entram como **referência de variável** (`${NOME}`). O store da IDE nunca grava o valor.
- Conectores `claude.ai` (Gmail, Drive etc.) são da conta Claude, via OAuth. Eles **não são portáveis**. Eles ficam no modal da conta e fora da biblioteca.

## Tipos de item

| Tipo | Formato na biblioteca | Portável entre providers? |
| --- | --- | --- |
| `skill` | Pasta com `SKILL.md` (formato aberto, front matter `name`/`description`) | Sim, nos providers que leem pasta de skills |
| `mcp` | `McpServerConfig` canônico (`stdio`/`http`), o mesmo de `profile-sync` | Sim, com `incompatible` por campo |
| `connector` | `mcp` remoto com `connector: true` e rótulo de exibição | Sim, mesma regra de `mcp` |
| `plugin` | **Referência por provider**: `{ provider, marketplace?, name }` | Não. Plugin é formato do provider. A biblioteca guarda a receita e o CLI oficial instala. |

## Matriz de projeção por provider

Fonte: matriz da spec de capacidades por conta (2026-11-14). Itens **[spike]** não foram verificados. Verifique no CLI real antes de implementar.

| Provider | Skills | MCP / conector | Plugin |
| --- | --- | --- | --- |
| Claude | `<CLAUDE_CONFIG_DIR>/skills/<id>` | `profile-sync` (`claude mcp add-json`) | `claude plugin install` (via executor) |
| Codex | `$CODEX_HOME/skills/<id>` | `profile-sync` (`config.toml`) | `codex plugin` **[spike]** |
| Gemini (`agy`) | `unsupported` ("só via plugin") | `profile-sync` (`agy mcp add`) | `agy plugin install` **[spike]** |
| Qwen | **[spike]** pasta de skills do usuário | `profile-sync` (`settings.json`) | `unsupported` (extensões) |
| OpenCode | `unsupported` v1 (pasta fora da conta, exige `global-file`) | `profile-sync` (`opencode.json` do projeto) | `unsupported` v1 |
| Kimi | `$KIMI_CODE_HOME/skills/<id>` **[spike]** | `$KIMI_CODE_HOME/mcp.json` | `unsupported` |
| Grok | `$GROK_HOME/skills/<id>` **[spike]** | `config.toml` **[spike]** | `grok plugin` **[spike]** |
| DeepSeek | `unsupported` | `unsupported` | `unsupported` |

A UI mostra o motivo de cada `unsupported`. Ela não esconde o provider.

## Modelo de dados

Novo arquivo `<root>/library/library.json` (aditivo; não muda `store.json`):

```typescript
type LibraryItemKind = 'skill' | 'mcp' | 'connector' | 'plugin';

interface LibraryItem {
  id: string;                 // slug estável: minúsculas, dígitos, hífen
  kind: LibraryItemKind;
  name: string;
  description: string | null;
  enabled: boolean;           // interruptor global da biblioteca
  source: 'created' | 'imported';
  definition: SkillDef | McpServerConfig | PluginRef;
  updatedAt: string;
}
```

- Skill: o conteúdo mora em `<root>/library/skills/<id>/` (cópia da pasta, com `SKILL.md`). O JSON guarda só o hash.
- Adição opcional em `Project`: `libraryOverrides?: { disabled: string[] }` (ids desligados neste projeto).
- Itens projetados recebem um marcador: skills com arquivo `.inova-managed` na pasta; MCP com nome registrado em `<root>/library/managed.json`. A IDE só altera e remove o que ela marcou.

## Arquitetura

- `src/core/library/` (núcleo, sem Electron): `types.ts`, `store.ts` (CRUD + atomic write), `skills.ts` (validação e projeção), `project.ts` (resolve item efetivo), `plugins.ts` (receita → comando).
- `src/core/profile-sync.ts`: `readCanonicalMcpConfig` passa a mesclar `.mcp.json` do projeto com os itens `mcp`/`connector` efetivos da biblioteca. Os adaptadores por provider **não mudam**.
- Preview e apply: reuse `previewProfileSync`/`applyProfileSync` (create/update/unchanged/conflict/incompatible, backup, confirmação). Skills e plugins entram como novos tipos de `ProfileSyncItem`.
- Plugins: a IDE monta o comando e entrega ao **executor de comandos** (Frente 2). Ela não instala por conta própria.
- Quando sincroniza: (1) ao salvar um item; (2) ao vincular uma conta ou projeto; (3) botão "Sincronizar". No início de cada turno, a IDE só compara hash (barato) e avisa na Inbox se houver divergência. Ela não grava no início do turno.
- Main: handlers `listLibrary`, `saveLibraryItem`, `removeLibraryItem`, `setProjectOverride`, `previewLibrarySync`, `applyLibrarySync`. Valide input em `validation.ts`.
- Renderer: seção "Biblioteca" em Configurações (`SettingsModal`), mais um painel de override no `ProjectSettingsModal`.

## Regras de negócio (viram contratos)

1. Um item `enabled: false` na biblioteca não chega a nenhum provider.
2. Item efetivo = biblioteca ligada, projeto não desligou, conta não desligou.
3. Item do projeto (`.mcp.json`) vence item da biblioteca com o mesmo nome.
4. A IDE nunca altera nem remove skill ou MCP sem o marcador `.inova-managed`/`managed.json`.
5. Toda gravação faz backup antes e é atômica.
6. A biblioteca nunca grava valor de segredo. Só referência `${VAR}`.
7. Um provider sem suporte recebe `unsupported` com motivo. A sincronização dos outros providers continua.
8. Remover um item da biblioteca remove só as projeções marcadas, após preview.
9. Conflito (arquivo existente sem marcador com o mesmo nome) exige confirmação explícita. O padrão é não sobrescrever.

## Fora do escopo (v1)

- Marketplace ou busca de skills na internet.
- OAuth de conector feito pela IDE.
- Conectores `claude.ai`.
- Skills no OpenCode (`global-file`).
- Versionar a biblioteca no git.

## Riscos e spikes obrigatórios

Esta frente toca gravação em arquivos do usuário e config de provider. Ela entra na lista de risco: exige auto-revisão adversarial antes do PR.

1. Spike: pasta de skills de Qwen, Kimi e Grok no CLI real.
2. Spike: `codex plugin install`, `agy plugin install` e `grok plugin` existem e aceitam modo não interativo?
3. Spike: Claude com `CLAUDE_CONFIG_DIR` lê `skills/` dessa pasta de conta? Verifique com `/context` headless.
4. Decisão aberta: symlink ou cópia para skills. O padrão proposto é **cópia** (funciona no Windows sem privilégio). Symlink só como opção.

## Tarefas propostas (sub-issues)

| # | Tarefa | Tipo | Depende de |
| --- | --- | --- | --- |
| 1 | Modelo, store e CRUD da biblioteca (`src/core/library`) | feat | — |
| 2 | Projeção de MCP e conector via `profile-sync` (mescla com `.mcp.json`) | feat | 1 |
| 3 | Projeção de skills (cópia + marcador + preview/apply) | feat | 1 |
| 4 | Plugins por receita, via executor de comandos | feat | 1, Frente 2 |
| 5 | Handlers, validação e IPC | feat | 1 |
| 6 | UI: seção Biblioteca e override por projeto | feat | 5 |

Cada `feat` cria um `*.contract.test.*` novo e um `*.edge.test.*` (regras 1 a 9 acima).
