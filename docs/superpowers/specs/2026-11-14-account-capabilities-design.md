# Capacidades por conta: skills, MCP, conectores e plugins

Data: 2026-11-14 · Branch: `feat/account-capabilities`

## Intenção

Cada conta conectada carrega skills, servidores MCP, conectores e plugins que não são úteis em toda sessão. Esses itens gastam contexto. Numa conta Claude, o usuário mediu cerca de 80k tokens de MCP. A maior parte vem dos conectores claude.ai do Google (Gmail, Calendar, Drive, Docs, Sheets, Slides).

A tela "Contas e providers" ganha um botão de engrenagem em cada conta. O botão abre um modal que lista os itens da conta e permite desligar cada item. O objetivo é reduzir o gasto de tokens sem desinstalar nada.

## Objetivos

- Engrenagem em cada linha de conta, nos 8 providers: Claude, Codex, Gemini (`agy`), Qwen, OpenCode, DeepSeek (`dsh`), Kimi e Grok.
- O modal lista os itens por categoria: Skills, MCP, Conectores e Plugins.
- Cada item tem uma chave liga/desliga.
- A escolha vale para a conta inteira, em todos os projetos.
- A mudança vale a partir do próximo turno. O Inova abre um processo novo do CLI em cada turno (`buildChatTurn`).
- Cada item mostra onde a mudança vale: "só no Inova", "na conta" ou "global".

## Fora do escopo

- Instalar, desinstalar ou editar a definição de um item (comando, URL, headers).
- Regras por projeto.
- Estimar quantos tokens cada item gasta.
- Autorizar conectores claude.ai que pedem OAuth.

## Anti-objetivos

- Corromper ou apagar a configuração do usuário. Toda gravação em arquivo faz backup antes e grava de forma atômica.
- Mudar o comportamento de uma conta que o usuário não abriu no modal.
- Exibir valores de tokens, headers ou variáveis `env` de MCP no modal ou nos logs.
- Ler arquivos `.env*`.

## Abordagens consideradas

| Abordagem | Como funciona | Trade-off |
| --- | --- | --- |
| A. Gravar no arquivo de cada provider | O Inova edita `settings.json`, `config.toml`, `mcp.json` etc. | Vale também no terminal. Exige 8 gravadores e edição de TOML sem parser. Risco de corromper configuração. |
| B. Sobreposição ao abrir a sessão | O Inova guarda os itens desligados no próprio armazenamento e passa flags ou `--settings` em cada turno | Não toca arquivo do usuário. Vale só no Inova. OpenCode, Kimi e Grok não têm flag para isso. |
| **C. Híbrida (escolhida pelo usuário)** | B onde o provider tem flag. A só onde não há flag, com backup. | Cobre os 8 providers com o menor risco. A UI precisa mostrar onde cada mudança vale. |

## Modos de aplicação

Cada item tem um modo de aplicação (`applyMode`):

| Modo | Rótulo na UI | Fonte do estado | Efeito |
| --- | --- | --- | --- |
| `launch` | "Só no Inova" | `store.json` do Inova | O Inova adiciona flags ou `--settings` ao montar cada turno. O arquivo do provider não muda. |
| `account-file` | "Na conta" | Arquivo de configuração na pasta da conta | O Inova grava no arquivo, ou roda o comando `enable`/`disable` do próprio CLI. |
| `global-file` | "Global" | Arquivo fora da pasta da conta | Igual a `account-file`, mas afeta todas as contas daquele provider e o CLI fora do Inova. A UI pede confirmação. |
| `unsupported` | "Não configurável" | — | A chave fica desabilitada e um tooltip explica o motivo. |

Regra: se o provider tem um comando `enable`/`disable` próprio, use o comando em vez de editar o arquivo.

## Matriz por provider

Fonte: pesquisa de 2026-11-14 nas docs oficiais e no `--help` local. Claude, Codex e `agy` estão instalados nesta máquina. Os outros 5 providers foram pesquisados só na documentação. Itens marcados com **[spike]** precisam de confirmação no CLI real antes da implementação (ver "Spikes obrigatórios").

### Claude (`CLAUDE_CONFIG_DIR`)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| Skills (pessoais) | Pastas `$CFG/skills/*/SKILL.md` (nome e `description` do frontmatter) | `skillOverrides: { "<nome>": "off" }` no `--settings` do turno | `launch` |
| Skills (de plugin) | Pasta `skills/` dentro do `installPath` de cada plugin de `claude plugin list --json` | `permissions.deny: ["Skill(<plugin>:<nome>)"]` no `--settings` **[spike]** | `launch` |
| MCP (escopo de usuário) | `mcpServers` no topo de `$CFG/.claude.json` (só nomes e tipo) | `permissions.deny: ["mcp__<nome-normalizado>"]` no `--settings` **[spike]** | `launch` |
| Conectores claude.ai | Linhas `claude.ai <Nome>` de `claude mcp list` (texto). Rodar com `CLAUDE_CONFIG_DIR` da conta. | Igual a MCP, com o prefixo `mcp__claude_ai_<Nome>`. Se todos os conectores estiverem desligados, use também `disableClaudeAiConnectors: true`. | `launch` |
| Plugins | `claude plugin list --json` → `{ id, enabled, installPath, scope, version }` | `enabledPlugins: { "<id>": false }` no `--settings` **[spike]** | `launch` |

Montagem: o adaptador de turno do Claude adiciona `--settings '<json>'` só quando a conta tem algum item desligado. O JSON junta `skillOverrides`, `permissions.deny`, `enabledPlugins` e `disableClaudeAiConnectors`.

Normalização do nome MCP: copie a regra do Claude Code. Troque todo caractere fora de `[A-Za-z0-9_-]` por `_`. Exemplo: `claude.ai Gmail` → `claude_ai_Gmail`. **[spike]** confirma a regra com os nomes reais da conta.

### Codex (`CODEX_HOME`)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `codex mcp list --json` | `-c mcp_servers.<nome>.enabled=false` | `launch` |
| Plugins | `codex plugin list --json` | `-c 'plugins."<id>".enabled=false'` **[spike]** | `launch` |
| Skills | Pastas `~/.agents/skills/*/SKILL.md` e `$CODEX_HOME/skills/*/SKILL.md` | `-c` com `skills.config` (array de tabelas inline com `name` e `enabled=false`) **[spike]**. Se `-c` não aceitar, use `account-file`: bloco `[[skills.config]]` no `config.toml` da conta. | `launch` (fallback `account-file`) |
| Conectores (apps) | Não confirmado | — | `unsupported` |

### Gemini / Antigravity (`agy`, `HOME` falso por conta)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `agy mcp list` (texto: NAME, TYPE, STATUS) | `agy mcp disable <nome>` / `agy mcp enable <nome>`. Rodar com o `HOME` da conta. | `account-file` |
| Plugins | `agy plugin list --json` (inclui `enabled` e as skills de cada plugin) | `agy plugin disable <nome>` / `agy plugin enable <nome>` | `account-file` |
| Skills | Vêm de `agy plugin list --json` | Só junto com o plugin. A UI mostra as skills agrupadas no plugin. | `unsupported` por skill |

Se o **[spike]** mostrar que `agy --settings` aceita desligar MCP, mude MCP para `launch`. Se não aceitar, fica `account-file`.

### Qwen (`HOME` falso por conta, `~/.qwen/settings.json`)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `mcpServers` em `~/.qwen/settings.json` | `--allowed-mcp-server-names <lista dos ligados>` no turno **[spike]**. Fallback: `mcp.excluded` no `settings.json` da conta. | `launch` (fallback `account-file`) |
| Extensões (plugins) | Pastas `~/.qwen/extensions/*/qwen-extension.json` | `-e <nome>` repetido para cada extensão ligada. Se todas estiverem desligadas, use `-e none`. | `launch` |
| Skills | Pastas de skills de usuário em `~/.qwen` **[spike]** | `skills.disabled` (lista) no `settings.json` da conta | `account-file` |

### OpenCode (`XDG_DATA_HOME` por conta)

A configuração fica em `~/.config/opencode/opencode.json`, fora da pasta da conta. O Inova isola hoje só a pasta de dados.

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `mcp` em `opencode.json` | `"disabled": true` no servidor **[spike]**: confirme a chave atual | `global-file` |
| Plugins | Lista `plugins` em `opencode.json` e pastas `~/.config/opencode/plugins/` | Prefixo `-` na lista `plugins` | `global-file` |
| Skills | Pastas `~/.config/opencode/skills/*/SKILL.md` | Regra `permissions` com `action: "skill"`, `resource: "<id>"`, `effect: "deny"` | `global-file` |

Decisão do construtor (marcada como escolha do orquestrador): mantenha `global-file` e peça confirmação na UI. Não mude `XDG_CONFIG_HOME` das contas OpenCode neste trabalho. Essa mudança alteraria o comportamento atual das contas.

### Kimi (`KIMI_CODE_HOME`)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `mcpServers` em `$KIMI_CODE_HOME/mcp.json` | `"enabled": false` no servidor | `account-file` |
| Plugins | `$KIMI_CODE_HOME/plugins/installed.json` **[spike]** | Só pelo comando `/plugins disable` dentro da sessão | `unsupported` |
| Skills | Pastas `$KIMI_CODE_HOME/skills/*/SKILL.md` | Sem chave por skill | `unsupported` |

### Grok (`GROK_HOME`)

| Categoria | Listar | Desligar | Modo |
| --- | --- | --- | --- |
| MCP | `grok inspect --json` **[spike]**, ou `[mcp_servers.*]` em `$GROK_HOME/config.toml` | `enabled = false` na tabela `[mcp_servers.<nome>]` | `account-file` |
| Skills | `grok inspect --json`, ou pastas `$GROK_HOME/skills` | `[skills] disabled = [...]` **[spike]**: confirme o tipo | `account-file` |
| Plugins | `grok plugin list`, ou pastas `$GROK_HOME/plugins` | `grok plugin disable <id>` se existir. Senão, `[plugins] disabled = [...]`. | `account-file` |

Se `grok` aceitar override por flag (`-c` ou equivalente), mude para `launch`. O **[spike]** decide.

### DeepSeek (`DSH_HOME`)

Não há documentação oficial de skills, MCP ou plugins. O modal mostra o estado vazio: "Este provider não expõe itens configuráveis."

## Edição de arquivos (`account-file` e `global-file`)

- JSON: leia, altere só a chave alvo, preserve as outras chaves e a indentação de 2 espaços, e grave de forma atômica (arquivo temporário + `rename`). Use o padrão `writeAtomic` de `src/core/profile-sync.ts`.
- TOML (Codex e Grok): não adicione dependência nova. Edite por linhas, no mesmo estilo de `stripTomlMcpSections` em `profile-sync.ts`. Mude só a linha `enabled` da tabela alvo, ou adicione essa linha na tabela. Se o arquivo tiver uma forma que o editor não entende (tabela inline, chave com aspas complexas), recuse a gravação e mostre um erro. Não tente adivinhar.
- Backup: antes de cada gravação, copie o arquivo para `<dataRoot>/backups/capabilities/<timestamp>/`. Use o padrão de backup de `profile-sync.ts`.
- Comandos de CLI (`agy mcp disable` etc.): rode com o env isolado da conta (`isolatedEnv`) e com timeout. Se o código de saída for diferente de 0, mostre um erro e releia o estado.

## Modelo de dados

Adição opcional e retrocompatível em `Account` (`src/core/types.ts`):

```typescript
export type CapabilityKind = 'skill' | 'mcp' | 'connector' | 'plugin';

export interface CapabilityRef {
  kind: CapabilityKind;
  id: string;
}

export interface Account {
  id: string;
  provider: ProviderId;
  label: string;
  homeDir: string;
  createdAt: string;
  disabledCapabilities?: CapabilityRef[];
}
```

- `disabledCapabilities` guarda só os itens de modo `launch`.
- Itens `account-file` e `global-file` usam o arquivo nativo como fonte do estado. O Inova não duplica esse estado.
- Um id que some da lista do provider (item desinstalado) continua salvo, mas não aparece no modal. O Inova ignora esse id ao montar o turno, porque um bloqueio de item inexistente não tem efeito.

Item exibido no modal (tipo compartilhado em `apps/desktop/src/shared/api.ts`):

```typescript
export interface CapabilityItem {
  kind: CapabilityKind;
  id: string;
  name: string;
  description: string | null;
  source: 'user' | 'plugin' | 'connector' | 'bundled';
  enabled: boolean;
  applyMode: 'launch' | 'account-file' | 'global-file' | 'unsupported';
  unsupportedReason: string | null;
}
```

## Arquitetura

- `src/core/capabilities/` (núcleo, sem Electron):
  - `types.ts`: os tipos acima.
  - Um módulo por provider (`claude.ts`, `codex.ts` …) que implementa:

    ```typescript
    interface CapabilityAdapter {
      list(ctx: { account: Account; runner: CommandRunner; env: NodeJS.ProcessEnv }): Promise<CapabilityItem[]>;
      launchArgs(disabled: readonly CapabilityRef[]): string[];
      setEnabled(ctx: SetEnabledContext): Promise<void>;
    }
    ```

    `launchArgs` devolve `[]` em providers sem modo `launch`. `setEnabled` trata `account-file` e `global-file`.
  - `index.ts`: mapa `ProviderId → CapabilityAdapter`.
- `src/core/launch.ts`: `buildChatTurn` recebe `account.disabledCapabilities` e anexa `launchArgs(...)` aos args do provider. A mudança é aditiva: sem itens desligados, os args ficam iguais aos atuais. Os testes atuais de `launch.ts` não podem mudar.
- Main (`apps/desktop/src/main`): handlers novos `listCapabilities({ accountId })` e `setCapabilityEnabled({ accountId, kind, id, enabled })`. Valide o input em `validation.ts`, no padrão dos handlers existentes. `launch` grava no store com `withStoreLock`. `account-file` e `global-file` chamam `adapter.setEnabled`.
- Renderer: `AccountCapabilitiesModal.tsx`, aberto pela engrenagem em `AccountsView.tsx` (coluna "Ações").

## UI

```
┌ Configurar conta · tito@… (Claude) ─────────────────────── ✕ ┐
│ [Skills 12] [MCP 3] [Conectores 9] [Plugins 4]   🔍 filtrar   │
│ ───────────────────────────────────────────────────────────── │
│ ● claude.ai Gmail        conector   Só no Inova      [ on  ] │
│ ● claude.ai Google Drive conector   Só no Inova      [ off ] │
│ ● graft                  MCP        Só no Inova      [ on  ] │
│ …                                                             │
│ ───────────────────────────────────────────────────────────── │
│ As mudanças valem a partir da próxima mensagem.               │
└───────────────────────────────────────────────────────────────┘
```

- Abas com contador. Esconda abas com 0 itens.
- A chave salva na hora (sem botão "Salvar"). Ela mostra um estado de carregamento até o main confirmar. Se falhar, a chave volta e o modal mostra o erro.
- Itens `global-file`: antes de salvar, abra `ConfirmModal`: "Esta mudança afeta todas as contas OpenCode e o OpenCode fora do Inova."
- Itens `unsupported`: chave desabilitada e tooltip com `unsupportedReason`.
- Conta deslogada ou CLI ausente: o modal mostra o motivo e não lista nada.
- Siga os componentes e tokens de CSS existentes (`modal.css`, `ConfirmModal`, `settings-controls.tsx`).

## Spikes obrigatórios (antes do plano final)

Rode cada spike no CLI real. Registre o resultado no plano. Spikes que dependem de CLI não instalado ficam marcados como "não verificado" e usam o fallback descrito na matriz.

1. Claude: um `--settings` com `permissions.deny: ["mcp__claude_ai_Gmail"]` remove as ferramentas e as instruções do servidor do contexto? Meça com `/context` headless (fork, sem persistir a sessão). Compare com `disableClaudeAiConnectors: true`.
2. Claude: `enabledPlugins: { "<id>": false }` via `--settings` desliga um plugin ativo na sessão? `Skill(<plugin>:<nome>)` em `deny` esconde a skill?
3. Codex: `-c 'plugins."<id>".enabled=false'` e `-c` com `skills.config` funcionam?
4. `agy`: `agy mcp disable` grava onde? `--settings` aceita restrição de MCP?
5. Qwen, OpenCode, Kimi, Grok: só se o CLI for instalado. Senão, use os fallbacks.

## Testes

- Núcleo: teste de unidade para cada adaptador, com fixtures de arquivos e saídas de CLI (`src/core/fixtures`). Cubra: listagem, `launchArgs`, edição JSON, edição TOML (tabela existente, tabela sem `enabled`, forma desconhecida → erro) e backup.
- `launch.ts`: um teste por provider com modo `launch`, com e sem itens desligados.
- Main: validação de input dos dois handlers novos.
- Renderer: teste de estado puro (filtro, contadores, aba visível), no padrão de `*-state.ts`.

## Decisões fechadas após a revisão do construtor

Escolhas do orquestrador. O usuário pode revisar cada uma.

1. **Sincronização de perfil preserva o estado.** `profile-sync.ts` sobrescreve a entrada inteira de cada servidor MCP (`mergeMcpServersJson`, `formatCodexMcpToml`, `agy mcp add/remove`). Isso apagaria `enabled: false` / `disabled: true` gravados por este recurso. Inclua no escopo: ao sincronizar, preserve as chaves `enabled` e `disabled` que já existem no destino. Adicione testes para JSON, TOML e `agy`.
2. **Onde as flags de `launch` entram.** Use um helper único, `capabilityLaunchArgs(account)`, em três caminhos que abrem sessão de trabalho:
   - `buildChatTurn` (turnos do chat do desktop);
   - o `/context` headless do painel de contexto (`handlers.ts`, `claudeContextArgs`), para que o painel mostre o contexto já reduzido;
   - `runProject` do CLI `inova` (`src/project-commands.ts`).
   Não adicione flags em login, status de autenticação, consumo nem listagem de capacidades.
3. **Precedência do `--settings` no Claude.** `--settings` é uma fonte a mais. Arrays de `permissions.deny` se somam entre as fontes, e `deny` vale também no modo `bypass`. Fallback se o spike 1 mostrar que `deny` não tira o item do contexto:
   - conectores claude.ai viram uma chave única "Todos os conectores claude.ai", que liga ou desliga `disableClaudeAiConnectors`. Cada conector fica `unsupported`, com o motivo no tooltip.
   - MCP de usuário vira `account-file`: o Inova grava o servidor desligado em `projects[<path>].disabledMcpServers` de cada projeto vinculado à conta em `.claude.json`. Grave com backup e de forma atômica.
4. **Listagem lenta.** `claude mcp list` faz um teste de saúde em cada servidor. Rode a listagem de cada categoria em paralelo, com timeout de 30 s por comando. O modal mostra cada aba assim que ela chega. Uma categoria que falhar mostra o erro só na aba dela. Guarde em memória (no main) o último resultado por conta e mostre esse resultado enquanto a listagem nova roda.
5. **Itens de projeto ficam fora.** Servidores de `.mcp.json` e skills de `.claude/skills` do projeto não aparecem no modal. Isso segue o fora de escopo "regras por projeto". O valor `'project'` sai do tipo `source`.
6. **Formato do id.** `CapabilityRef.id` guarda o nome cru, exatamente como o provider lista. Exemplos: `claude.ai Gmail`, `<plugin>:<skill>`, `<nome>@<marketplace>`. A normalização (por exemplo, `mcp__claude_ai_Gmail`) só acontece em `launchArgs`. Se dois nomes crus normalizarem para o mesmo valor, o bloqueio vale para os dois. Documente isso num teste.
7. **Concorrência.** No main, serialize as gravações por caminho de arquivo com uma fila em memória: leia, altere e grave dentro da fila. Serialize também os comandos de CLI por conta. Depois de qualquer falha, releia o estado do provider e mostre o estado real. Nunca mostre o estado otimista.

## Deixado para o construtor

- Nomes de arquivos e funções internas.
- Ordem das abas e texto exato dos tooltips.
- Cache da listagem (por exemplo, recarregar ao abrir o modal).
