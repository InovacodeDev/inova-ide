# Fluxo de desenvolvimento

Este documento é a fonte única do fluxo. Ele vale para pessoas e para agentes.

## Regras

1. Nunca faça commit ou push na `main`. Toda mudança entra por PR.
2. Toda mudança começa em uma issue do projeto `IDE` no InovaFlow.
3. Cada issue tem uma branch com a chave da issue e um PR que cita a chave.
4. Toda mudança de código tem teste. Os testes seguem dois padrões (seção "Testes").
5. Um teste de contrato que já está na `main` é imutável.
6. Todo PR atualiza o `CHANGELOG.md` na seção `[Não lançado]` (seção "Changelog").

## Passo a passo

### 1. Crie a issue no InovaFlow

Crie a issue no projeto `IDE` do InovaFlow. A descrição tem objetivo, escopo e critérios de aceite.

| Situação                          | Status da issue |
| --------------------------------- | --------------- |
| O desenvolvimento começa agora    | `in_progress`   |
| A demanda só fica registrada      | `backlog`       |

Se a issue já existe, não crie outra. Mova a issue para `in_progress`.

### 2. Crie a branch com a chave da issue, com base na `main`

```bash
git switch -c <tipo>/IDE-<n>-<slug> origin/main
```

Formato do nome: `<tipo>/<CHAVE>-<n>-<slug>`. O slug usa minúsculas, dígitos e hífen.

O formato antigo `<tipo>/<numero>-<slug>`, com issue do GitHub, continua aceito. Nele, a PR policy
exige a tarefa com label `tarefa`, a demanda pai, a branch vinculada e `Closes #<numero>`.

| Tipo                                    | Uso                              | Testes exigidos no PR                                             |
| --------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `feat`                                  | Funcionalidade nova              | Um contrato novo e um arquivo de cenários de bug novo ou alterado |
| `fix`                                   | Correção de bug                  | Um arquivo de cenários de bug novo ou alterado                    |
| `refactor`, `perf`                      | Mudança sem alterar comportamento | Nenhum teste novo. Os testes existentes devem passar              |
| `docs`, `test`, `chore`, `ci`, `build`  | Mudança sem código de produção   | Proibido alterar código de produção                               |

### 3. Desenvolva e abra o PR

```bash
gh pr create --base main --title "<tipo>: <título> (IDE-<n>)" --body "InovaFlow: IDE-<n>"
```

O título ou a descrição do PR deve citar `IDE-<n>`. Depois de abrir o PR, mova a issue para
`in_review` e vincule o PR à issue no InovaFlow.

Antes de abrir o PR, registre a mudança no `CHANGELOG.md` (seção "Changelog").

### 4. Faça o merge

O merge exige os checks `PR policy` e `verify` verdes. Depois do merge, mova a issue para `done`.

## Testes

| Padrão          | Arquivo             | Objetivo                                         | Pode alterar depois do merge?                    |
| --------------- | ------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Contrato        | `*.contract.test.*` | Garante a regra de negócio                       | Não. Só com a label `contrato-alteracao-aprovada` |
| Cenários de bug | `*.edge.test.*`     | Ataca o fluxo: entrada inválida, limite, falha   | Sim                                              |

- Crie o contrato quando a funcionalidade surgir. Uma funcionalidade nova tem um arquivo novo.
- Não adicione casos a um contrato existente. Crie outro arquivo de contrato.
- Se um contrato falhar, corrija o código. Não altere o teste.
- A alteração de um contrato exige pedido explícito do dono do produto. Só ele aplica a label
  `contrato-alteracao-aprovada` no PR. Agentes nunca aplicam essa label.
- Os testes `*.test.*` antigos continuam válidos. Eles não contam como contrato nem como cenários
  de bug.

Locais: `src/**/*.test.ts` (CLI), `apps/desktop/test/**/*.test.ts` (desktop) e
`scripts/**/*.test.mjs` (scripts, com `node --test`).

## Changelog

Todo PR registra o que fez no `CHANGELOG.md`, sob o título `## [Não lançado]`, no mesmo PR.

- Use a subseção `### Adicionado`, `### Alterado`, `### Corrigido`, `### Removido` ou `### Segurança`.
  Crie a subseção se ela não existir.
- Escreva uma linha por mudança, em português, no passado, do ponto de vista de quem usa o app.
- Não crie seção de versão. O script de release move o conteúdo de `[Não lançado]` para a versão.
- A branch `release/vX.Y.Z` é a única exceção. O script de release já atualiza o arquivo.
- Agentes seguem a mesma regra. Um PR sem entrada nova em `[Não lançado]` não está pronto.

## Release

Rode o release em uma branch `release/vX.Y.Z`, nunca na `main`.

```bash
git checkout -b release/v<versão> origin/main
pnpm version:deploy <major|minor|patch>
gh pr create --base main --title "chore: release v<versão>" --body "Release v<versão>"
```

A branch de release não exige issue. Ela não pode alterar código de produção.

## O que garante o fluxo

| Mecanismo                               | O que valida                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Workflow `PR policy`                    | Nome da branch, chave do InovaFlow citada no PR (ou, no formato antigo, issue do GitHub vinculada), testes exigidos, contratos imutáveis |
| Workflow `CI` (`verify`)                | Typecheck, lint e testes nos três sistemas                                   |
| Workflow `Main guard`                   | Falha se um commit chegar na `main` sem PR com merge                         |
| Ruleset `main-dev-flow` (sem bypass)    | Bloqueia push direto e exige os checks acima                                 |
| Ruleset `main` (bypass só por PR)       | Exige revisão. O time `owners` pode dispensar a revisão, só dentro de um PR  |

O workflow `PR policy` roda com o código da `main`, não com o código do PR. Um PR não consegue
alterar a própria validação.

Se você mudar a issue depois de abrir o PR (label, sub-issue, branch vinculada), rode o check
`PR policy` de novo.

## Configuração do repositório

O script cria as labels e os rulesets. Ele é idempotente.

```bash
node scripts/dev-flow/setup-github.mjs
node scripts/dev-flow/setup-github.mjs --apply
```

O primeiro comando mostra o plano. O segundo aplica.
