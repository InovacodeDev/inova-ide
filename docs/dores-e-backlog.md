# Dores de Desenvolvedores e Backlog do InovaIDE

Este documento registra as 20 dores identificadas na pesquisa da conversa e acompanha o status de solução no InovaIDE.

## Top 5 Maiores Dores

- [x] **1. Interrupção por Rate Limit no meio da tarefa**
  - **Problema:** Limites de janela (5h ou semanais) e erros HTTP 429 travam a execução no meio do turno e exigem troca manual de conta.
  - **Solução implementada:** Failover automático configurável (`off`, `same-provider` ou `any-provider`) via configuração `sessions.rateLimitFailover`, com rollback de turno com erro, geração de contexto de handoff, reatribuição da fila e tentativa automática na próxima conta elegível.
  - **Arquivos principais:** `src/core/handoff.ts`, `src/core/settings.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/renderer/SettingsSections.tsx`.

- [x] **2. Loops infinitos de erro e queima de tokens**
  - **Problema:** O agente repete a mesma chamada com falha ou sequências de verificações quebradas e consome quota sem progresso.
  - **Solução implementada:** Circuit Breaker de sessão (`sessions.circuitBreaker`) com limites conservadores configuráveis para erros repetidos de ferramenta, falhas consecutivas de verificação e teto de tokens por turno, pausando a sessão/fila e enviando alerta na caixa de entrada.
  - **Arquivos principais:** `src/core/circuit-breaker.ts`, `src/core/settings.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/renderer/SettingsSections.tsx`.

- [x] **3. Amnésia de contexto após compactação ou nova sessão**
  - **Problema:** Após `/compact`, rewind, limpeza, handoff ou início de nova sessão, o agente esquece regras e decisões arquiteturais do projeto.
  - **Solução implementada:** Memória Fixada (Scratchpad) por projeto e por sessão (até 4.000 caracteres por nível), editável na aba **Contexto** do painel lateral e via comando local `/pin <texto>` no chat, com reinjeção inteligente por hash em novos turnos e após `/compact`, `clearSession`, `rewindSession`, `handoffSession` e `forkSession`.
  - **Arquivos principais:** `src/core/types.ts`, `src/core/handoff.ts`, `src/core/projects.ts`, `src/core/sessions.ts`, `src/core/slash-commands.ts`, `apps/desktop/src/main/handlers.ts`, `apps/desktop/src/renderer/SessionDetails.tsx`, `apps/desktop/src/renderer/ChatView.tsx`.

- [ ] **4. Viés de autoconfirmação na revisão de código**
  - **Problema:** O mesmo agente que escreve o código frequentemente afirma que o diff não possui bugs.
  - **Solução planejada:** Botão de revisão adversarial em 1 clique na aba **Git** que inicia uma subsessão `read-only` limpa para auditar o diff e enfileirar correções.

- [ ] **5. Falta de visibilidade financeira por sessão e projeto**
  - **Problema:** Desenvolvedores não enxergam quanto cada tarefa ou sessão custou em USD e em tokens de cache, entrada e saída.
  - **Solução planejada:** Rastreador de custo em USD e contagem de tokens por turno salvo no store local e exibido por sessão e por projeto no inspetor.

## Próximas 15 Dores do Backlog (Itens 6 a 20)

- [ ] **6. Perda de soluções antigas no histórico de chats** — Busca global (`⌘Shift+F`) no conteúdo de todas as sessões ativas e arquivadas.
- [ ] **7. Trabalho manual de copiar erros de lint e teste para o chat** — Botão "Corrigir falhas" e modo auto-repair que envia a saída dos `verificationChecks` diretamente ao agente.
- [ ] **8. Servidor local quebra fora do turno do agente** — Monitor de processos de dev com envio de stack trace em 1 clique para a sessão ativa.
- [ ] **9. Repetição manual de prompts complexos entre projetos** — Biblioteca de templates de prompt com variáveis (`{{arquivo}}`, `{{branch}}`) no compositor.
- [ ] **10. Poluição da janela de contexto por logs gigantes de teste** — Compactador automático de `stdout/stderr` que resume logs longos antes de enviar ao contexto.
- [ ] **11. Agente altera arquivos fora do escopo da tarefa** — Guardião de escopo (File Lock / Blast Radius) para bloquear pastas ou exigir aprovação fora do escopo.
- [ ] **12. Sair da IDE para criar commit e Pull Request após aprovar o diff** — Ações de `Commit` e `Criar PR` integradas à aba `Git` do worktree.
- [ ] **13. Detalhamento de contexto exclusivo para o Claude** — Expandir o inspetor "O que consumiu o contexto" para Codex, Gemini e OpenCode.
- [ ] **14. Gasto de quota paga em tarefas triviais ou offline** — Roteamento nativo para modelos locais (Ollama / LM Studio) em tarefas simples.
- [ ] **15. Servidores MCP travados ou consumindo tokens em excesso** — Painel de diagnóstico de MCPs com status de conexão e custo de tokens por servidor.
- [ ] **16. Dificuldade para referenciar linhas exatas de código no prompt** — Seletor de intervalo de linhas no modal de diff para inserir `@arquivo:L10-L25` no compositor.
- [ ] **17. Falta de documentação das decisões tomadas na sessão** — Exportação de sessão para Markdown e geração de ADR (Architecture Decision Record) no repositório.
- [ ] **18. Vazamento de RAM/CPU por processos órfãos de agentes** — Monitor de recursos no rodapé com botão para encerrar processos órfãos de CLIs e subagentes.
- [ ] **19. Agente concorda com premissas erradas sem questionar ("Yes-man")** — Alternador "Modo Cético / Grill-Me" no compositor para validar requisitos antes de editar código.
- [ ] **20. Perda de turno quando o Mac entra em sleep ou a rede oscila** — Reconexão automática e retomada segura de turno interrompido por falha de rede.
