# Executor de comandos da IDE (terminal por baixo dos panos)

Data: 2026-11-17 · Status: rascunho para aprovação · Frente 2 de 3 (ver também `ide-capability-library-design` e `composer-autoformat-design`)

## Intenção

A IDE precisa rodar comandos de terminal por conta própria: instalar um plugin, atualizar uma extensão do `gh`, consultar o estado de um CLI. Hoje cada ponto do main chama `execFile` à mão (`index.ts`, `shell-env.ts`, `CommandRunner`).

## Leitura escolhida do pedido (decisão declarada)

"Terminal por baixo dos panos" = **executor oculto usado pela IDE**. Não é um painel de terminal digitável pelo usuário.

Um painel com xterm e shell livre fica **fora do escopo** desta spec. Ele pode vir depois. Motivo: um shell livre aceita texto do renderer. Isso é uma fronteira de confiança e entra na lista de risco.

## O que já existe (reuse)

| Peça | Onde | Uso |
| --- | --- | --- |
| `CommandRunner` (não interativo, sem TTY) | `src/core/providers.ts` | Base do executor para o caso comum |
| PATH do shell de login | `loginShellPath`, `baseEnv()` | O executor enxerga `gh`, `brew` etc. como o terminal do usuário enxerga |
| `resolveWindowsSpawn` | `@inova/win-env` | Resolve `.cmd` e `.exe` no Windows |
| `killProcessGroup` | `process-group.ts` | Cancelamento e timeout |
| `stripAnsi` | `main/` | Limpa a saída |
| `maskSecretsInText` | `profile-sync.ts` | Mascara segredo antes de logar ou mostrar |
| `node-pty` | `index.ts`, `sessions.ts` | Só para comandos que exigem TTY |

`@xterm/xterm` está no `package.json` do desktop. O renderer **não importa** o pacote hoje. A v1 não precisa dele.

## Por que não usar `SessionManager`

`SessionManager.open` exige `LaunchSpec` e `accountId`, e alimenta `accountsInUse()`. Um comando da IDE não tem conta. Mudar esse contrato quebraria o login flow e o controle de contas em uso.

Decisão: o executor tem seu **próprio gerenciador** (`createCommandExecutor`) e reusa só `SpawnPty` (tipo) e `killProcessGroup`. `SessionManager` não muda.

## Fronteira de confiança (regra central)

O renderer **nunca** envia texto de comando. Ele envia `{ commandId, params }`.

```typescript
interface CommandSpec {
  id: string;                        // ex.: 'gh.extension.upgrade'
  binary: string;                    // ex.: 'gh'
  args: (params: unknown) => string[]; // monta o argv; valida params com o schema
  paramsSchema: Schema;              // validação formal, padrão do repo
  cwd: 'project' | 'ide-root' | 'none';
  mode: 'exec' | 'pty';              // 'pty' só se o comando exige TTY
  mutating: boolean;                 // true => pede confirmação e serializa
  timeoutMs: number;
  maxOutputBytes: number;
}
```

- O registro `COMMANDS` vive no **main**. Entrada nova = mudança de código revisada.
- Nenhum `sh -c`. O executor usa `execFile` com argv. Sem interpolação de shell.
- `cwd 'project'` aceita só um projeto vinculado (`resolveProject`). O caminho vem do store, não do renderer.
- O env vem de `baseEnv()`. O executor nunca lê `.env*`.
- Os comandos do plano são **exemplos**. Esta spec não fixa a lista. Cada frente registra os seus.

## API do executor

```typescript
interface CommandExecutor {
  run(input: { commandId: string; params: unknown; projectId?: string; signal?: AbortSignal }):
    Promise<{ runId: string }>;
  cancel(runId: string): void;
  onEvent(cb: (e: CommandEvent) => void): void; // start | output | exit | error
}
```

- Saída em streaming: `stripAnsi`, mascarada, truncada em `maxOutputBytes` (marca "saída cortada").
- Resultado final: `{ exitCode, durationMs, truncated }`.
- Binário ausente: erro tipado `BinaryNotFound` com o nome do binário. Sem stack para o usuário.

## Regras de negócio (viram contratos)

1. Um `commandId` fora do registro é recusado. Nenhum processo nasce.
2. `params` que falham no schema são recusados antes de qualquer processo.
3. O executor nunca passa texto livre do renderer a um shell.
4. Comando `mutating` roda um por vez por projeto (fila). Comando não mutante roda em paralelo.
5. Comando `mutating` pede confirmação na UI antes de rodar, com o argv final visível.
6. Timeout e cancelamento matam a árvore de processos (`killProcessGroup`). Nenhum órfão fica vivo.
7. A saída passa por `stripAnsi` e por `maskSecretsInText` antes de sair do main.
8. `cwd 'project'` com projeto desconhecido é recusado.
9. `mode: 'pty'` só abre quando o registro marca TTY. O resto usa `exec`.
10. No Windows, `resolveWindowsSpawn` resolve o binário. O comportamento é o mesmo do macOS.

## UI (mínima na v1)

- Um indicador "Comandos" no rodapé, com lista de execuções recentes e saída **somente leitura**.
- Botão cancelar em execução ativa.
- Diálogo de confirmação para `mutating` (reuse `ConfirmModal`).
- Sem campo de digitação. Sem xterm na v1.

## Fora do escopo (v1)

- Painel de terminal interativo com shell livre.
- Entrada do usuário em comandos PTY (um `gh auth login` interativo precisa de decisão própria).
- Persistir histórico de saída em disco.

## Riscos

Tarefa de risco: execução de processo e fronteira renderer → main. Exige auto-revisão adversarial antes do PR. Pontos a atacar: injeção de argumento (`--` e valores que começam com `-`), path traversal em `cwd`, vazamento de segredo na saída, processo órfão.

## Tarefas propostas (sub-issues)

| # | Tarefa | Tipo | Depende de |
| --- | --- | --- | --- |
| 1 | Núcleo do executor (`exec`, fila `mutating`, timeout, cancelamento, truncagem) | feat | — |
| 2 | Registro `COMMANDS` + validação de params + cwd de projeto | feat | 1 |
| 3 | Modo `pty` para comandos com TTY (sem tocar `SessionManager`) | feat | 1 |
| 4 | Handlers/IPC (`runCommand`, `cancelCommand`, evento de saída) e `validation.ts` | feat | 2 |
| 5 | UI: indicador "Comandos", saída somente leitura e confirmação | feat | 4 |

Cada `feat` cria um `*.contract.test.*` novo (regras 1 a 10) e um `*.edge.test.*`.
