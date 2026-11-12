# Inova IDE: launcher multi-conta para CLIs de agentes

Data: 2026-11-12 · Status: proposto

## Problema

Quero ligar cada projeto a uma conta de assinatura (Claude, Codex/ChatGPT, Gemini/Google) com login OAuth da própria conta, não com API key. Quero várias contas por provedor e um app desktop que abra cada projeto já na conta certa.

## Decisão central: envolver os CLIs oficiais, não fazer fork

| Opção | Viável? | Motivo |
| --- | --- | --- |
| Fork do Claude Code desktop | Não | Código fechado. Não existe repo para fazer fork. Engenharia reversa viola os termos. |
| Cliente próprio que extrai o token OAuth e chama a API | Não | Os termos da Anthropic proíbem: "developers may not collect, store, or intermediate Claude.ai credentials or session tokens". O bloqueio começou em jan/2026. OpenAI e Google têm risco parecido. |
| Agent SDK / adapter ACP do Claude com login de assinatura | Não | A Anthropic manda usar API key no Agent SDK. O `claude-agent-acp` roda sobre o Agent SDK. |
| **Envolver o binário oficial, sem modificar, com um diretório de config por conta** | **Sim** | A doc da Anthropic permite: "an end user [...] signing in to the unmodified Claude Code binary with their own Claude subscription". O login acontece no fluxo oficial. O app nunca lê, guarda nem trafega token. |
| API keys | Sim, mas fora do pedido | O usuário quer a conta de assinatura. |

## Mecanismo agnóstico

Cada CLI oficial aceita uma variável que aponta o diretório de config. Um diretório separado = uma conta separada.

| Provedor | Binário | Isolamento | Login | Status |
| --- | --- | --- | --- | --- |
| Claude | `claude` | `CLAUDE_CONFIG_DIR` | `claude auth login` | `claude auth status --json` |
| Codex | `codex` | `CODEX_HOME` | `codex login` | `codex login status` (exit code) |
| Gemini | `gemini` | `GEMINI_CLI_HOME` | `gemini` interativo → "Login with Google" | arquivo `<home>/.gemini/oauth_creds.json` existe |

Evidência local (2026-11-12): o Keychain do macOS desta máquina tem `Claude Code-credentials`, `Claude Code-credentials-1b65d025` e `Claude Code-credentials-2db276ed`. Isso indica que o Claude Code 2.1.289 cria uma entrada de Keychain por `CLAUDE_CONFIG_DIR`. A Task 1 do plano confirma isso com duas contas reais.

O núcleo tem três tipos:

- `ProviderAdapter`: dados por provedor (binário, variável de isolamento, args de login, como checar status, variáveis de API key a remover).
- `Account`: provedor, rótulo, diretório próprio em `~/.inova/accounts/<id>/` (modo 0700).
- `Project`: caminho absoluto e `accountId`.

Lançar = `spawn(binário, args, { cwd: projeto, env: env do processo − API keys do provedor + variável de isolamento })`.

## Regras

- O app nunca lê, copia, loga nem envia token. Só checa status pelo comando oficial ou pela existência do arquivo.
- O binário roda sem modificação, com todos os métodos de auth intactos.
- Remover uma conta apaga só o diretório dela dentro de `~/.inova/accounts/`. Nunca toca nos arquivos do projeto.
- Variáveis de API key do provedor (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`) saem do env do processo filho. Sem isso, o CLI usa a key em silêncio e ignora a conta.
- Termos mudam. O Codex e o Gemini também têm termos de consumidor. Reveja antes de distribuir o app para outras pessoas. Para uso pessoal, o desenho segue a regra mais restritiva (Anthropic).

## Fases

1. **Plano A (este ciclo):** biblioteca `core` + CLI `inova`. Contas, vínculo projeto→conta, login, status, `inova run`.
2. **Plano B (próximo ciclo):** app desktop. Electron + React + `node-pty` + `xterm.js`. Barra lateral com projetos; cada aba abre um PTY com o resultado de `buildLaunch()` do core. Alternativa: Tauri (binário menor, mas PTY em Rust e menos reuso do TS).
3. **Depois:** Antigravity. É uma IDE (fork do VS Code), não um CLI. Hipótese a verificar: abrir com `--user-data-dir <home da conta>`. ACP como protocolo de UI rica: viável para Gemini (`gemini --acp`, nativo) e Codex (`codex-acp`); não para Claude com assinatura (usa Agent SDK).

## Fora de escopo

Sincronizar contas entre máquinas. Mostrar uso/cota. Trocar de conta no meio de uma sessão. Suporte Windows/Linux (o design é portátil, mas só testo macOS).
