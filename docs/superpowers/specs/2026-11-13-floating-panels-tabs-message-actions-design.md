# Painéis flutuantes, abas, ações de mensagem e comandos `/` — design

Data: 2026-11-13 · Branch: `feat/floating-panels-tabs-message-actions`

## Intenção

Deixar a tela de sessão mais limpa e mais próxima de apps de chat modernos. O usuário quer:
identificar as próprias mensagens rápido, voltar atrás num turno sem bifurcar a sessão, trabalhar
em até 3 sessões ao mesmo tempo e descobrir os comandos nativos de cada provider no `/`.

## Escopo (3 blocos, nesta ordem)

### Bloco A — Layout

1. **Painel direito (`SessionDetails`) flutuante.** `position: absolute` dentro de `.app-body`.
   `top: 16px`, `right: 16px`. Altura = conteúdo; `max-height: calc(100% - 32px)` com
   `overflow-y: auto`. Borda arredondada, sombra, fundo `--panel`. Sem `border-left`. Sobrepõe
   levemente o conteúdo (pedido do usuário). A coluna do chat ganha `padding-right` igual à largura
   do painel + 16px para o texto não ficar coberto.
2. **Sidebar esquerda colapsável.** Botão de toggle no topo da sidebar. Estado persistido em
   `settings` (chave nova, opcional). Colapsada: a sidebar some e aparece uma barra vertical
   flutuante só de ícones (`top/left: 16px`), com tooltip. Itens: Nova sessão, Workspace, Agentes
   paralelos, Comparar, Contas e providers, e o botão de expandir.
3. **Abas de sessão.** `tabsReducer` já existe e cada aba já monta um `ChatView`. Falta:
   - barra de abas visível acima do `SessionHeader` (título, ícone do provider, status
     rodando, botão fechar);
   - limite `MAX_OPEN_TABS = 3`. Abrir a 4ª sessão mostra aviso "Limite de 3 abas. Feche uma aba."
     e não abre. Decisão do orquestrador: bloquear é previsível; substituir aba em silêncio
     poderia esconder um turno rodando.
   - restauração do workspace respeita o limite (corta as excedentes).

### Bloco B — Mensagens

4. **Mensagem do usuário.** Bolha com `max-width: 80%`, alinhada à direita. Rótulo "Você" sai.
   Abaixo, linha de metadados alinhada à direita: hora (`at` do evento `user`) · copiar ·
   retroceder · bifurcar (o botão "Bifurcar daqui" vira ícone nesta linha).
5. **Retroceder (rewind).** Handler novo `rewindSession({ sessionId, turnIndex })` no main:
   1. Falha se o turno estiver rodando.
   2. Lê o transcript. Acha o evento `user` do turno e o `checkpoint` imediatamente anterior.
   3. Se houver checkpoint: `restoreCheckpoint` (reverte arquivos editados pelo agente).
   4. Trunca o transcript antes do checkpoint/evento `user` (`writeTranscriptEvents`).
   5. Memória do agente: `providerSessionId = null` e `handoffContext` = resumo dos eventos
      restantes (`buildHandoffContext`), ou `null` se não restar nada. A próxima mensagem abre uma
      sessão nova no provider que não contém os turnos removidos.
   6. Devolve `{ text }` do turno removido. O renderer recarrega o chat e coloca o texto no
      composer.
   Pede confirmação (`ConfirmModal`) antes, porque reverte arquivos.
6. **Mensagem do agente.** Linha de metadados abaixo do último bloco de texto do turno: hora ·
   copiar · 👍 · 👎 · regerar · rótulo do modelo. Regerar só no último turno: executa rewind do
   último turno e reenvia o mesmo texto. Reações são locais: evento novo
   `{ kind: 'feedback'; turnIndex: number; value: 'up' | 'down' | null }` no transcript. Não são
   enviadas ao provider (nenhum CLI aceita feedback em modo headless).

### Bloco C — Comandos `/` e skills

7. **Catálogo de comandos nativos por provider** em `src/core/slash-commands.ts`. Cada entrada:
   `{ name, description, action }`, com `action`:
   - `'passthrough'`: o texto `/cmd args` vai como prompt ao CLI;
   - `'clear'`: o app limpa transcript e memória (mesmo mecanismo do rewind, sem resumo);
   - `'model-picker'`: abre o seletor de modelo/esforço existente.
   Só entram comandos que o app consegue executar. Fonte: pesquisa de 2026-11-13 (tabela abaixo).
8. **Popup do `/`** lista, por grupo: comandos nativos do provider da sessão, comandos do projeto
   e skills (já existentes em `src/core/commands.ts`).
9. **Skills como tag.** Escolher uma skill insere um chip `/nome` no composer. O evento `user`
   guarda `/nome args`. Claude recebe `/nome args` (skills funcionam em `-p`). Os outros providers
   recebem o corpo expandido no main, como hoje. A bolha renderiza o `/nome` inicial como tag
   (mesmo estilo de `chat-file-tag`) quando ele casa com uma skill ou comando conhecido.

## Catálogo inicial

| Provider | Comandos |
|---|---|
| claude | `/clear` (clear) · `/compact` · `/init` · `/review` · `/security-review` · `/mcp` (passthrough) · `/model`, `/effort` (model-picker) |
| codex | `/new` (clear) · `/model` (model-picker) |
| gemini (agy) | `/model` (model-picker). Sem `/clear`: o CLI não tem. |
| qwen | `/clear` (clear) · `/diff` · `/btw` · `/goal` (passthrough) · `/model` (model-picker) |
| kimi | `/clear` (clear) · `/goal` (passthrough) · `/model` (model-picker) |
| grok | `/clear` (clear) · `/model` (model-picker) |
| opencode | `/new` (clear) · `/models` (model-picker) |
| deepseek | `/model` (model-picker) |

Fontes: code.claude.com/docs/en/commands e /headless; codex-rs/tui/src/slash_command.rs;
antigravity.google/docs/cli/headless.md; qwenlm.github.io/qwen-code-docs; kimi.com/code/docs;
docs.x.ai/build/modes-and-commands; opencode.ai/docs/tui.

## Não-objetivos

- Enviar reações ao provider.
- Rewind nativo do Claude (`--resume-session-at` existe, mas é flag oculta e exige capturar UUIDs
  de mensagem). Fica como dívida.
- Mais de 3 abas; abas lado a lado (split).

## Anti-objetivos

- Retroceder sem reverter arquivos quando existe checkpoint.
- Mostrar no `/` um comando que não funciona no provider da sessão.

## Restrições

- Contratos IPC: só mudanças aditivas (canal novo `rewindSession`; evento `feedback` novo).
- Regras do repo: TS strict, sem comentários fora das tags permitidas, testes para lógica nova
  (reducer de abas, catálogo, truncagem do transcript, parsing de tag de skill).

## Decisões do orquestrador (corrigíveis)

- Limite de abas bloqueia em vez de substituir.
- Rewind usa resumo (handoff) para todos os providers.
- Regerar = rewind + reenvio, só no último turno.
- Reações ficam só locais.

## Deixado ao implementador

Nomes de classes CSS, ícones exatos, animação do colapso.
