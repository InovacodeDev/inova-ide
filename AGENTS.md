# InovaIDE: regras para agentes

Siga o fluxo de [docs/dev-flow.md](docs/dev-flow.md) em toda mudança. Resumo obrigatório:

1. Nunca faça commit ou push na `main`.
2. Planeje a demanda. Crie a issue da demanda (label `demanda`).
3. Crie uma sub-issue por tarefa (label `tarefa`, `--parent <demanda>`).
4. Crie a branch com `gh issue develop <tarefa> --base main --name <tipo>/<tarefa>-<slug> --checkout`.
5. Abra o PR para a `main` com `Closes #<tarefa>` na descrição.
6. Toda `feat` cria um `*.contract.test.*` novo e um `*.edge.test.*`. Todo `fix` cria ou atualiza um `*.edge.test.*`.
7. Nunca altere, remova nem renomeie um `*.contract.test.*` existente. Se ele falhar, corrija o código.
8. Nunca aplique a label `contrato-alteracao-aprovada`. Se a regra de negócio mudou, pare e peça a aprovação do usuário.

Checks antes de abrir o PR: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`,
`pnpm --filter @inova/desktop typecheck`, `pnpm --filter @inova/desktop test`.
