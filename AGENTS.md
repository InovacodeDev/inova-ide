# InovaIDE: regras para agentes

Siga o fluxo de [docs/dev-flow.md](docs/dev-flow.md) em toda mudança. Resumo obrigatório:

1. Nunca faça commit ou push na `main`.
2. Crie a issue no projeto `IDE` do InovaFlow (`kanban_create_issue`). Use `status: in_progress` se o
   desenvolvimento começa agora e `status: backlog` se a demanda é só registrada. Não crie issue no GitHub.
3. Crie a branch com `git switch -c <tipo>/IDE-<n>-<slug> origin/main`.
4. Abra o PR para a `main` com `IDE-<n>` no título. Mova a issue para `in_review` e vincule o PR
   (`github_link_issue_or_pr` com `projectKey: IDE`).
5. Depois do merge, mova a issue para `done`.
6. Toda `feat` cria um `*.contract.test.*` novo e um `*.edge.test.*`. Todo `fix` cria ou atualiza um `*.edge.test.*`.
7. Nunca altere, remova nem renomeie um `*.contract.test.*` existente. Se ele falhar, corrija o código.
8. Nunca aplique a label `contrato-alteracao-aprovada`. Se a regra de negócio mudou, pare e peça a aprovação do usuário.
9. Todo PR atualiza o `CHANGELOG.md` na seção `[Não lançado]` com o que foi feito. Só a branch `release/*` fica isenta.

Checks antes de abrir o PR: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`,
`pnpm --filter @inova/desktop typecheck`, `pnpm --filter @inova/desktop test`.
