# Inova IDE: Roadmap de Fluxos e Capacidades dos Provedores

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Roadmap consolidado

Este documento organiza a entrega dos fluxos de trabalho na branch `feat/ide-workflows`. Os itens originais de caixa de entrada (sessões em segundo plano e ações pendentes) foram unificados em um único subsistema, e a configuração de modos por provedor foi adicionada ao escopo.

| Ordem | Subprojeto | Escopo | Especificação |
| --- | --- | --- | --- |
| 1 | **Compositor e Comandos** | Autocomplete `@arquivo` (`.gitignore`) e `/` para prompts/skills do projeto | [2026-11-13-composer-autocomplete-commands-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-13-composer-autocomplete-commands-design.md) |
| 1B | **Modos por Provedor** | Seletor de modo de execução/permissão por sessão e provedor | [2026-11-13-provider-modes-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-13-provider-modes-design.md) |
| 2 | **Git, Worktrees e Verificação** | Worktree automático por sessão, checkpoints por turno e checks pós-turno | [2026-11-13-git-worktrees-checkpoints-verification-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-13-git-worktrees-checkpoints-verification-design.md) |
| 3 | **Orquestração e Caixa de Entrada** | Caixa de entrada única, fila/troca de conta, handoff e fork de sessão | [2026-11-13-session-orchestration-inbox-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-13-session-orchestration-inbox-design.md) |
| 4 | **Comparação e Perfil Unificado** | Execução paralela side-by-side e sincronização de MCPs e regras | [2026-11-13-parallel-compare-unified-profile-design.md](file:///Users/titorm/Inovacode/inova-ide/docs/superpowers/specs/2026-11-13-parallel-compare-unified-profile-design.md) |

## Inventário real das APIs e CLIs dos provedores

O Inova IDE encapsula as CLIs oficiais com diretórios de configuração isolados por conta (`src/core/providers.ts` e `src/core/launch.ts`). A tabela abaixo resume o que cada CLI/API entrega hoje e o que exige camada própria na IDE.

### 1. Claude (`claude`)

- **Isolamento**: `CLAUDE_CONFIG_DIR`. Remove `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`.
- **Modos de permissão (`--permission-mode`)**: `auto`, `manual`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`. Suporta `--dangerously-skip-permissions`, `--restricted`, `--tools` e `--permission-prompts <host|none>`.
- **Modelos e esforço**: `--model` (aliases `sonnet`, `opus`, `haiku`, `fable`, `opusplan` ou ID completo) e `--effort <low|medium|high|xhigh|max>`. Sem subcomando de listagem dinâmica; usa catálogo em `PROVIDER_MODELS`.
- **Sessão e fork**: `--session-id <uuid>`, `--resume <id>`, `--continue`, `--fork-session`. Suporta fork nativo do histórico a partir do último ponto salvo.
- **Streaming e métricas**: `--output-format stream-json --verbose --include-partial-messages` emite `session_id`, deltas de texto, `tool_use`, `tool_result`, `rate_limit_event` (`five_hour`, `seven_day`, `monthly`), `total_cost_usd` e `duration_ms`. Suporta `--input-format stream-json` e `--json-schema`.
- **Consumo/Quotas**: API OAuth `https://api.anthropic.com/api/oauth/usage` (com token do arquivo `.credentials.json` ou Keychain macOS) mais eventos `rate_limit_event` do stream.
- **MCPs, regras e worktree**: subcomando `claude mcp` (`add`, `add-json`, `remove`, `list`, `get`), flags `--mcp-config` / `--strict-mcp-config`, arquivo `CLAUDE.md`, `.claude/commands/`, `.claude/skills/`, e flag nativa `-w/--worktree`.

### 2. Antigravity / Gemini (`agy` — `provider: 'gemini'`)

- **Isolamento**: `HOME` isolado com symlinks para `.gitconfig`, `.gitignore_global`, `.ssh`, `.npmrc` e `.config/gh`. Remove `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT_ID`.
- **Modos de execução**: `--mode <accept-edits|auto|plan>`, `--dangerously-skip-permissions` (equivalente a Turbo) e `--sandbox`. Não possui flag `manual` com prompt interativo no modo `-p` simples; modo interativo requer `--input-format stream-json` ou terminal.
- **Modelos e esforço**: descoberta dinâmica via `agy models`; aceita `--model` e `--effort <low|medium|high|xhigh|max>`.
- **Sessão e fork**: `--conversation <id>` e `--continue`. Não possui flag nativa `--fork-session` por turno intermediário; fork na IDE exige novo turno com resumo de contexto.
- **Streaming e métricas**: `--output-format stream-json` emite `init` (`conversation_id`), `step_update` (`agent_response` delta, `tool`, `error_message`) e `result` (`status`, `duration_seconds`). Suporta `--input-format stream-json` e `--json-schema`.
- **Consumo/Quotas**: `agy -p /usage --output-format json` retorna buckets `gemini-5h`, `gemini-weekly`, `gemini-monthly` com `remaining_fraction` e `reset_time`.
- **MCPs e regras**: subcomando `agy mcp` (`add` com `-t stdio|http`, `-e`, `-H`, `remove`, `list`, `enable`, `disable`), skills em `.gemini/skills/`, comandos em `.gemini/commands/`, regras em `GEMINI.md`. Nota: o binário `gemini` (Gemini CLI padrão, se suportado no futuro) também expõe `--approval-mode <default|auto_edit|yolo|plan>`, `--yolo`, `--sandbox` e `-w/--worktree`.

### 3. Codex (`codex`)

- **Isolamento**: `CODEX_HOME` (com `cli_auth_credentials_store = "file"` em `config.toml`). Remove `OPENAI_API_KEY`, `CODEX_API_KEY`.
- **Modos de execução**: `--sandbox <read-only|workspace-write|danger-full-access>`, `--ask-for-approval` (`on-request`, `never`), `--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox` (`--yolo`). Nota: em `codex exec` sem TTY, `on-request` não aguarda interação humana e exige modo automático ou bypass.
- **Modelos e esforço**: `--model` e `-c model_reasoning_effort="<effort>"` (`minimal`, `low`, `medium`, `high`, `xhigh`). Usa catálogo em `PROVIDER_MODELS`.
- **Sessão e fork**: `codex exec resume <thread_id>`. Suporte a fork de thread na CLI interativa; em `exec` não há flag universal para retroceder a turno arbitrário, exigindo resumo na IDE para pontos intermediários.
- **Streaming e métricas**: `--json` emite `thread.started`, `item.started`, `item.completed` (`command_execution`, `agent_message`), `turn.completed` e `turn.failed`. Não informa custo em USD no evento final.
- **Consumo/Quotas**: leitura dos arquivos locais `sessions/YYYY/MM/DD/rollout-*.jsonl` no `CODEX_HOME` (`token_count` / `rate_limits`).
- **MCPs e regras**: seção `[mcp_servers.<nome>]` em `CODEX_HOME/config.toml` (políticas de MCP separadas da sandbox de arquivos), skills em `.agents/skills/` e instruções em `AGENTS.md`.

### 4. Qwen Code (`qwen`)

- **Isolamento**: `HOME` isolado com symlinks globais. Remove `DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, `QWEN_API_KEY`.
- **Modos de execução**: `--approval-mode <plan|default|auto-edit|yolo>` e `--yolo`.
- **Modelos e esforço**: `--model`; esforço não possui flag dedicada em `launch.ts` (usa catálogo estático).
- **Sessão e fork**: `--resume <id>` e `--continue`. Sem fork por ponto intermediário; depende de resumo na IDE.
- **Streaming e métricas**: `-p ... --output-format stream-json --include-partial-messages`.
- **Consumo/Quotas**: indisponível via API/arquivo local (`source: 'unavailable'`).
- **MCPs e regras**: `qwen mcp add` / configurações de projeto e `SKILL.md`.

### 5. Kimi Code (`kimi`)

- **Isolamento**: `KIMI_CODE_HOME`. Remove `MOONSHOT_API_KEY`, `KIMI_API_KEY`.
- **Modos de execução**: `--yolo` (aprovação automática de rotina, pergunta ações críticas) e `--auto` (execução autônoma sem perguntar). Sem flag explícita de modo `plan` somente leitura.
- **Modelos e esforço**: `-m <model>`; catálogo estático.
- **Sessão e fork**: `-S <id>` / `--session` e `--continue`. Sem fork intermediário.
- **Streaming e métricas**: `--print --output-format stream-json`.
- **Consumo/Quotas**: indisponível (`source: 'unavailable'`).
- **MCPs e regras**: configuração via settings locais do `KIMI_CODE_HOME`.

### 6. Grok (`grok`)

- **Isolamento**: `GROK_HOME`. Remove `XAI_API_KEY`, `GROK_API_KEY`.
- **Modos de execução**: `--always-approve` (alias `--yolo`) ou modo padrão com confirmação. Sem modo `plan` nativo dedicado.
- **Modelos e esforço**: `--model`; catálogo estático.
- **Sessão e fork**: `-r <id>` e `-c`. Sem fork intermediário.
- **Streaming e métricas**: `-p ... --output-format streaming-json`.
- **Consumo/Quotas**: indisponível (`source: 'unavailable'`).
- **MCPs e regras**: servidores MCP via configuração local e inspeção (`grok inspect`).

### 7. OpenCode (`opencode`)

- **Isolamento**: `XDG_DATA_HOME`. Remove `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
- **Modos de execução**: flag `--auto` no comando `run` e regras granulares `permission` (`allow`, `ask`, `deny`) por agente em `opencode.json`.
- **Modelos e esforço**: descoberta dinâmica via `opencode models` (`provider/model`), passada com `-m`.
- **Sessão e fork**: `-s <sessionId>` em `opencode run`. Sem fork por turno intermediário via CLI `run`.
- **Streaming e métricas**: `opencode run --format json` emite `sessionID`, `text`, `tool_use` e `step_finish` com `cost`.
- **Consumo/Quotas**: indisponível (`source: 'unavailable'`).
- **MCPs e regras**: bloco `mcp` (singular) em `opencode.json` / `opencode.jsonc` e agentes customizados com `permission` (singular).

### 8. DeepSeek Harness (`dsh` — `provider: 'deepseek'`)

- **Isolamento**: `DSH_HOME`. Remove `DEEPSEEK_API_KEY`.
- **Modos de execução**: `--profile headless` combinado com `--mode` passado ao runner (atualmente `workspace-write` em `launch.ts`, além de perfis configuráveis em `$DSH_HOME/profiles`).
- **Modelos e esforço**: `--model`; catálogo estático.
- **Sessão e fork**: `--session-id <id>`. Sem fork por turno intermediário.
- **Streaming e métricas**: `--jsonl` emite fluxo JSON por linha.
- **Consumo/Quotas**: indisponível (`source: 'unavailable'`).
- **MCPs e regras**: configuração gerenciada via perfil no `DSH_HOME`.

## Matriz comparativa resumida

| Provedor | Modos nativos | Descoberta de modelos | Uso / Quota | Fork nativo | MCP CLI / Config |
| --- | --- | --- | --- | --- | --- |
| `claude` | `auto`, `manual`, `acceptEdits`, `plan`, `bypassPermissions` | Estático | OAuth API + stream | Sim (último ponto) | `claude mcp` + `--mcp-config` |
| `gemini` (`agy`) | `accept-edits`, `auto`, `plan`, `--dangerously-skip-permissions`, `--sandbox` | Dinâmico (`agy models`) | `agy -p /usage` | Não | `agy mcp` |
| `codex` | `--sandbox` (`read-only`, `workspace-write`, `danger-full-access`), `-a`, `--yolo` | Estático | Arquivos `rollout-*.jsonl` | Parcial (CLI) | `config.toml` (`[mcp_servers]`) |
| `qwen` | `--approval-mode` (`plan`, `default`, `auto-edit`, `yolo`) | Estático | Não | Não | `qwen mcp` / settings |
| `kimi` | Padrão, `--yolo`, `--auto` | Estático | Não | Não | Settings `KIMI_CODE_HOME` |
| `grok` | Padrão, `--always-approve` | Estático | Não | Não | Settings `GROK_HOME` |
| `opencode` | `--auto` + `permission` em `opencode.json` | Dinâmico (`opencode models`) | Não | Não | `opencode.json` (`mcp`) |
| `deepseek` | `--mode` (`workspace-write`) / perfis | Estático | Não | Não | Perfil `DSH_HOME` |

## Implicações arquiteturais para os próximos subprojetos

1. **Modos por provedor**: a UI deve expor um seletor unificado com rótulos claros (inspirados nos menus de Claude e Antigravity/Local Permissions), exibindo apenas modos reais do provedor e bloqueando ou alertando quando um modo exige TTY/aprovação interativa.
2. **Worktrees e Checkpoints**: embora `claude -w` e `gemini -w` existam, apenas `git worktree` e commits de referência no `@inova/core` garantem comportamento idêntico entre os 8 provedores e comparação side-by-side.
3. **Fork e Handoff**: como nenhum provedor suporta retomar um turno arbitrário do meio de outra CLI ou transferir sessão entre contas isoladas, a IDE precisa persistir turnos estruturados e gerar resumo de handoff no `@inova/core`.
4. **Perfil unificado de MCPs e regras**: cada CLI lê formato e diretório próprio (`claude mcp`, `agy mcp`, `config.toml`, `opencode.json`); a sincronização deve adaptar o formato canônico do projeto por adaptador de provedor com pré-visualização explícita.
