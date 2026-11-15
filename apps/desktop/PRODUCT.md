# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Desenvolvedores e tech leads que usam múltiplos provedores e contas locais de agentes de código para trabalhar em repositórios Git locais, evitando interrupções por limite de quota, mantendo contexto crítico entre sessões e controlando alterações e custos diretamente no desktop ou via CLI.

## Product Purpose

O InovaIDE é um workspace desktop e CLI (`inova`) multi-conta para orquestrar agentes locais de programação em um único fluxo contínuo. Ele resolve interrupções por rate limit com failover automático, bloqueia loops e consumo excessivo com circuit breaker, preserva decisões importantes por memória fixada, oferece revisão adversarial isolada por outra conta ou provedor e dá visibilidade financeira real de tokens e USD por turno, sessão e projeto.

## Positioning

Arquitetura estritamente local-first com armazenamento sob `~/.inova` (ou `INOVA_HOME`), sem dependência de backend em nuvem nem aprisionamento a um único provedor, combinando orquestração multi-conta, worktrees Git isoladas, checkpoints reversíveis e contabilidade fiel apenas ao que os provedores emitem.

## Operating Context

- Aplicativo desktop Electron com interface React/CSS (`@inova/desktop`) distribuído para macOS (`arm64`), Windows (`x64`) e Linux (`x64`), acompanhado pela CLI `inova`.
- Integração com contas autenticadas nos provedores suportados pelo workspace (Claude, Codex, Gemini, DeepSeek, Kimi, Grok, Qwen e OpenCode).
- Fluxo diário centrado em projetos locais, worktrees isoladas, fila de turnos, verificações automáticas do projeto e inspetor lateral (`Contexto`, `Git`, `Subagentes`, `Sessão`).

## Capabilities and Constraints

- **Idioma da interface:** todo texto voltado ao usuário deve ser escrito em Português (`pt-BR`), preservando em inglês apenas termos técnicos, flags, identificadores e comandos.
- **Armazenamento local-first:** contas, vínculos de projeto, transcrições (`.jsonl`) e totais agregados (`store.json`) residem localmente em `~/.inova` (`INOVA_HOME`), sem exigir sincronização em nuvem.
- **Transparência estrita de custos e tokens:** somar apenas valores `costUsd` efetivamente retornados pelos provedores e sinalizar turnos sem custo ou parciais, sem inventar tabelas estáticas de preço.
- **Controles sempre legíveis em linha única:** botões de ação, abas, filtros e pílulas mantêm rótulo em linha única (`white-space: nowrap`), reservando `white-space: normal` apenas para cartões descritivos explícitos.
- **Preservação do sistema visual existente:** qualquer evolução de UI respeita a densidade operacional atual, os temas escuro e claro por tokens CSS e os fluxos existentes do `@inova/desktop`.

## Brand Commitments

- **Nome oficial:** InovaIDE (`@inova/desktop` e CLI `inova`).
- **Tom de produto:** técnico, direto e factual, sem linguagem promocional nem métricas ou depoimentos inventados.

## Evidence on Hand

- `README.md` e `CHANGELOG.md` documentam plataformas suportadas, comandos da CLI `inova` e histórico de versões.
- `docs/dores-e-backlog.md` registra as 20 dores de desenvolvedores levantadas para o produto, com os itens 1 a 5 marcados como concluídos e os itens 6 a 20 abertos no backlog.
- `apps/desktop/src/renderer/tokens.css` e `apps/desktop/src/renderer/styles.css` contêm os tokens atuais de cor, tipografia, bordas e botões em execução no app.
- Ainda não existe `DESIGN.md` documentando formalmente a camada visual do sistema.

## Product Principles

- **Dados locais sob controle do usuário:** estado, credenciais e histórico permanecem no ambiente local.
- **Continuidade acima de provedor único:** trocar de conta ou modelo durante falhas ou revisões preserva o trabalho sem atrito.
- **Proteção contra desperdício:** prevenir loops, estouro de contexto e custos ocultos por padrão.
- **Verdade observável:** exibir apenas dados reais dos provedores e indicar com clareza quando métricas estão ausentes.
- **Clareza operacional:** priorizar leitura rápida, previsibilidade espacial e ações em linha única para uso intenso de engenharia.

## Accessibility & Inclusion

- Suporte a temas escuro e claro configurados por tokens em `:root` e `:root[data-theme='light']`.
- Foco visível com `:focus-visible`, navegação por teclado em modais/paletas/tabs e redução de animação sob `prefers-reduced-motion: reduce`.
