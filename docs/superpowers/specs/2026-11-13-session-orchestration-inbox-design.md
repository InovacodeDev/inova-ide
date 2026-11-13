# Inova IDE: Orquestração de Sessões, Fila, Handoff, Fork e Caixa de Entrada

Data: 2026-11-13 · Status: aprovado · Branch: `feat/ide-workflows`

## Problema e escopo

Com múltiplas sessões paralelas e limites de uso por conta, o usuário precisa saber rapidamente qual sessão em segundo plano parou, evitar bloqueios por conta ocupada/esgotada e ramificar ou transferir conversas entre contas e provedores.

Este subprojeto entrega quatro capacidades integradas:

1. **Caixa de entrada única** (unificação dos itens 7 e 12): lista centralizada de sessões em segundo plano que terminaram, falharam ou aguardam resposta.
2. **Fila de turnos e troca de conta**: enfileiramento quando a conta está ocupada ou opção de rodar em outra conta livre.
3. **Handoff entre contas ou provedores**: geração de resumo estruturado para continuar o trabalho quando uma conta falha ou atinge o limite.
4. **Bifurcação de sessão (Fork)**: duplicar uma sessão a partir de qualquer turno anterior, com fork nativo quando suportado ou resumo de contexto nos demais casos.

## 1. Caixa de entrada única (`Inbox`)

### Modelo de atenção (`apps/desktop/src/renderer/inbox-state.ts` e `@inova/core`)

Cada sessão mantém em runtime no processo main (e/ou persistido em `Session.attention` opcional) o último estado de atenção relevante:

```typescript
export type InboxAttentionKind = 'completed' | 'failed' | 'waiting-input';

export interface InboxItem {
  sessionId: string;
  projectId: string;
  sessionTitle: string;
  projectName: string;
  provider: ProviderId;
  kind: InboxAttentionKind;
  summary: string;
  at: string;
  unread: boolean;
}
```

Regras de geração e leitura:

- **`completed`**: turno finaliza com sucesso (`done` com `isError: false`, ou verificação pós-turno aprovada) enquanto a sessão **não** é a aba ativa visível da janela em foco.
- **`failed`**: turno termina com erro (`done` com `isError: true` ou erro de processo) ou verificação pós-turno falha.
- **`waiting-input`**: turno enfileirado aguardando ação do usuário (ex.: escolha de troca de conta por limite atingido, conflito ao aplicar worktree, ou confirmação pendente).
- **Abertura direta**: clicar em um item da Caixa de Entrada seleciona o projeto/aba da sessão (`openSession` + `setView('workspace')`), rola até o último evento e marca o item como lido (`unread: false`).
- **UI**: seção dedicada **"Caixa de entrada"** no topo da `Sidebar` com badge numérico de itens não lidos, filtro por tipo (`Todas`, `Erros`, `Aguardando`) e botão **"Limpar lidas"**. Notificação nativa do SO opcional quando a janela está em segundo plano e ocorre `failed` ou `waiting-input`.

## 2. Fila de turnos e troca de conta (`apps/desktop/src/main/turn-queue.ts`)

### Regra de concorrência por conta

Hoje `ChatRunner.accountsInUse()` já rastreia quais contas têm um turno ativo, mas `sendMessage` não bloqueia nem enfileira turnos de sessões diferentes na mesma conta. Isso pode causar conflitos de quota ou estado de CLI.

Com a fila de turnos:

1. **Detecção de ocupação e limite**:
   - Antes de iniciar `runTurn`, verifica se a conta alvo está ocupada em outra sessão (`chat.accountsInUse().has(account.id)`) ou se o último `UsageSnapshot` / evento de erro indica janela esgotada (`usedPercent >= 100` ou erro conhecido de rate limit).
   - O usuário escolhe por projeto/sessão ou no momento do conflito entre:
     - **Enfileirar turno**: adiciona `{ turnId, sessionId, prompt, enqueuedAt }` na fila da conta; o turno aparece no chat e na sidebar como `na fila` (com botão para cancelar da fila) e inicia automaticamente quando a conta ficar livre.
     - **Mover para outra conta livre**: lista outras contas autenticadas e ociosas do mesmo provedor (ou outro provedor compatível).
2. **Troca explícita de conta na sessão (`Session.accountIdOverride`)**:
   - Como cada conta usa diretório isolado (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `HOME`), o `providerSessionId` da conta anterior não existe na conta nova.
   - Ao trocar de conta em uma sessão que já possui histórico (`providerSessionId !== null`), o sistema exibe aviso claro ("A nova conta não herda a sessão interna da CLI anterior; será gerado um resumo de handoff automático") e executa o fluxo de **Handoff** antes do próximo turno.

## 3. Handoff entre contas ou provedores (`src/core/handoff.ts`)

### Geração do pacote de contexto estruturado

`buildHandoffContext(input: { events: ChatEvent[]; gitSummary?: string; fromProvider: ProviderId; toProvider: ProviderId })` constrói a partir do transcript `.jsonl` um resumo determinístico e compacto (limitado a ~12.000 caracteres para caber com folga no prompt inicial):

1. **Objetivo original**: primeira mensagem do usuário e resumo dos pedidos seguintes.
2. **Progresso realizado**: trechos finais das respostas do assistente e lista de ferramentas de edição/execução concluídas.
3. **Arquivos e estado Git**: resumo de `git status --short` e `git diff --stat` no `effectiveCwd` (quando em repo Git).
4. **Pendências e erros**: último erro do turno, erro de limite de uso ou falha de verificação pós-turno.

### Fluxo de ativação

- **Manual**: botão **"Transferir (Handoff)"** no cabeçalho da sessão para enviar a sessão para outra conta ou outro provedor (criando sessão filha vinculada por `parentId` e mantendo o mesmo `worktree` se o usuário desejar, ou um novo).
- **Automático assistido por limite/falha**: quando um turno falha por limite de uso (`rate_limit`, `quota`, `429`), o card de erro e a Caixa de Entrada oferecem ação em 1 clique: **"Continuar com resumo em outra conta/provedor"**.

## 4. Bifurcação de sessão (`Fork` a partir de turno anterior)

### Rastreamento por turno no transcript

Cada turno do usuário registrado no `.jsonl` (`{ kind: 'user', text, at }`) passa a delimitar um ponto de bifurcação indexado (`turnIndex: 0, 1, 2...`), associado opcionalmente ao `checkpointRef` Git criado antes daquele turno.

### Estratégia por provedor ao clicar em "Bifurcar daqui"

O usuário escolhe em qualquer turno anterior do `ChatView`: conta/provedor de destino e se deseja copiar o estado de arquivos daquele ponto (quando houver `checkpointRef` + worktree).

| Caso | Estratégia executada |
| --- | --- |
| Último turno concluído, mesmo provedor/conta com fork nativo (`claude` com `--fork-session`) | Cria sessão filha copiando o transcript até aquele ponto e usa `ChatTurn { mode: 'fork', parentProviderSessionId, sessionId }` |
| Turno intermediário (anterior ao fim da conversa) no `claude` ou em qualquer outro provedor | Cria sessão filha copiando os eventos do transcript até o turno escolhido, marca `providerSessionId = null` e anexa bloco de contexto gerado por `buildHandoffContext` para o próximo turno da sessão bifurcada |
| Troca de conta ou troca de provedor na bifurcação | Cria sessão filha vinculada ao novo provedor/conta com transcript até o turno escolhido e resumo de `buildHandoffContext` (mantendo o histórico original intacto) |

Nota: para provedores sem fork pontual em turnos intermediários (`gemini`/`agy`, `codex` em `exec`, `qwen`, `kimi`, `grok`, `deepseek`, `opencode`), a UI indica explicitamente que a sessão bifurcada continuará via resumo estruturado do histórico até o ponto selecionado.

## Plano de testes

- `src/core/handoff.test.ts`: extração determinística de objetivo, edições, erros, truncamento dentro do teto de caracteres e inclusão de `gitSummary`.
- `apps/desktop/test/turn-queue.test.ts`: enfileiramento FIFO por conta, cancelamento de item na fila, liberação automática ao concluir turno, detecção de conflito de conta.
- `apps/desktop/test/inbox-state.test.ts`: transições `completed`/`failed`/`waiting-input`, supressão de `completed` na aba ativa em foco e marcação de leitura ao abrir.
- `apps/desktop/test/handlers.test.ts`: `forkSession` (nativo no último turno do Claude vs truncado + handoff em turno intermediário/outro provedor), `handoffSession`, `switchSessionAccount` e canais IPC da fila e inbox.
