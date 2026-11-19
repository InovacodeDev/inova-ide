# Changelog

Todas as mudanças relevantes do Inova IDE ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

### Alterado

- Lista de modelos disponíveis atualizada para todos os providers (`Claude`, `Codex`, `Gemini`, `DeepSeek`, `Kimi`, `Grok`, `Qwen` e `OpenCode`), incluindo `GPT 6.2 Astra`, `GPT 6.2 Sol`, `Gemini 4 Neon`, `DeepSeek V4.1 Flash`, `Kimi K3.1 Pro`, `Grok 4.7` e `Qwen 4 Max`.

### Corrigido

- Consumo de contas Gemini (Antigravity) passou a resolver o binário `agy` pelo ambiente efetivo do usuário (`baseEnv`) com diretório da conta e timeout de 30s, corrigindo a exibição de consumo indisponível no app empacotado e detectando sessão expirada.
- Status de consumo do Claude deixou de ficar preso em HTTP 429 depois de um longo tempo sem uso: o Inova renova o token OAuth vencido da conta (mesmo endpoint, lock e armazenamento do Claude Code CLI, com verificação da gravação no Keychain ou em `.credentials.json`), e um 429 pausa as consultas da conta (respeita `Retry-After`; sem o header, espera de 2 min a 30 min em backoff exponencial) mantendo o último valor válido na tela.

## [0.10.1] - 2026-11-18

### Adicionado

- Botão `Buscar atualização` na aba `Geral` das configurações: verifica na hora se existe uma versão nova e mostra se o app está atualizado, se há versão disponível, se nenhuma versão foi publicada ou se a busca falhou (`pt-BR` e `en-US`).

## [0.10.0] - 2026-11-18

### Adicionado

- Biblioteca de capacidades da IDE: skills, servidores MCP, conectores e plugins pertencem à IDE (`<root>/library/`) e valem para todo projeto e todo provider, sem reinstalar item por conta.
- Seção `Biblioteca` nas configurações e painel de override por projeto para ligar ou desligar itens. O item efetivo exige estar ligado na biblioteca e no projeto e não desligado na conta; o item do projeto vence o da biblioteca com o mesmo nome.
- Projeção da biblioteca nas contas dos providers pelo `profile-sync`: skills por cópia com marcador, MCP e conectores com marcador gerenciado (incluindo `codex`), prévia com aprovação antes de gravar e remoção aprovada dos itens que a biblioteca deixou de reter.
- Instalação de plugins pelo CLI oficial do provider, executada sob o ambiente da conta, com matriz de suporte por provider.
- Executor de comandos da IDE: o renderer envia só `{ commandId, params }` e o `main` monta o `argv` a partir de um registro validado, sem `sh -c`. Comandos que alteram estado pedem confirmação e rodam em fila; há modo `pty` para comandos que exigem TTY, timeout, limite de saída e limpeza do processo.
- Indicador de comandos na interface, com saída somente leitura e diálogo de confirmação.
- Composer com autoformatação estilo Slack: `` `código` ``, `*negrito*`, `_itálico_` e `~riscado~` viram formato ao digitar o delimitador de fechamento, e `- `, `1. `, `> ` e ` ``` ` viram lista, lista numerada, citação e bloco de código. `Backspace` logo após a conversão devolve o texto literal e `Ctrl+Z` desfaz.

### Segurança

- A biblioteca rejeita texto com formato de chave de API e detecta segredos literais (incluindo `Bearer`) nos campos dos itens. Segredos de MCP entram só como referência de variável (`${NOME}`); a IDE não guarda valor de token.
- A prévia de sincronização mascara `args`, segredos em URL (inclusive entre aspas) e todo valor de MCP do `codex` fora de uma lista de chaves seguras.
- A aprovação da sincronização fica presa a uma chave do estado previsto de cada alvo e ao subconjunto MCP dele; mudança no alvo exige nova aprovação.
- O executor mascara segredos na saída e remove variáveis de ambiente de credencial do provider dos comandos de plugin.

### Corrigido

- A autoformatação do composer não converte `snake_case`, `__init__`, URLs, caminhos, tokens que começam com `@` ou `/` nem texto dentro de `code`, e não roda durante composição IME nem ao colar.
- Item da biblioteca semanticamente inválido vai para quarentena e aparece na seção com ação de remover, em vez de travar a biblioteca inteira; itens com `id` fora do formato de slug podem ser removidos.
- Entrada de MCP sem marcador que difere da projeção vira conflito; MCP gerenciado só é removido quando a entrada do alvo bate com o hash gravado, e o nome gerenciado é liberado quando um servidor do projeto o assume.
- Tabelas MCP do `codex` que não são gerenciadas são preservadas, e servidores idênticos do usuário não são mais adotados como gerenciados. Entrada inline do `codex` informa o próprio motivo de conflito.
- Config ilegível de uma conta vira conflito dessa conta, sem derrubar a sincronização das demais. A prévia volta ao estado inicial quando a biblioteca muda.
- Skill removida da biblioteca ganha backup antes da remoção, e o conector desligado na conta é respeitado. O botão de instalar some para plugin desativado, e o painel explica o limite de skills por projeto.
- Arquivo temporário da biblioteca é limpo quando o `rename` final falha.

## [0.9.3] - 2026-11-17

### Adicionado

- Painel lateral direito de visualização de arquivos (`FileViewerPane`) redimensionável e maximizável, com múltiplas abas, drag-and-drop e seletor nativo.
- Renderizadores somente-leitura para código e texto (com números de linha, destaque `shiki` e busca interna), Markdown, HTML isolado via protocolo `inova-preview://`, planilhas (`.xls`, `.xlsx`, `.xlsm`, `.ods`, `.csv`, `.tsv`), imagens, PDF e fallback externo.
- Gatilhos de abertura ao clicar em links/caminhos nas respostas, cartões de ferramenta, alterações Git do inspetor e Paleta de Comandos.

### Corrigido

- Detecção de CLIs no Windows quando o ambiente herdado usa a chave `Path` em vez de `PATH`, lê o `Path` do Registro do Windows (`HKCU` e `HKLM`) e inclui diretórios padrão de instalação (`.local\bin`, `pnpm`, `npm`, `WinGet\Links`, `.bun\bin`, `scoop\shims` e `.cargo\bin`).
- Resolução de binários no Windows prioriza `.exe`, `.com`, `.cmd` e `.bat` sobre arquivos sem extensão (evitando selecionar o script POSIX gerado pelo `npm`/`pnpm`) e executa wrappers `.cmd`/`.bat` via `cmd.exe /d /s /c`.

## [0.9.2] - 2026-11-16

### Corrigido

- Manifesto do Winget corrigido para declarar `InstallerType: nullsoft` no instalador NSIS do Windows.

## [0.9.1] - 2026-11-16

### Adicionado

- Publicação automática de manifestos do Winget (`InovacodeDev.InovaIDE`) no pipeline de release e documentação em `docs/release-winget.md`.
- Instalador Windows (NSIS) adiciona o comando `inova` ao `Path` do usuário automaticamente e remove na desinstalação.
- Atualização dentro do aplicativo no Windows via Winget com verificação prévia de disponibilidade e reinício automático após o upgrade.

## [0.9.0] - 2026-11-16

### Adicionado

- Visão dividida: abra uma aba ao lado da aba atual pelo botão de colunas na barra de abas; cada painel tem barra própria com foco e botão de fechar.
- Reordenação das abas por arrastar e soltar no header; a ordem é salva no workspace.
- Ações do circuit breaker de contexto: `Compactar e continuar` (primária, via `/compact`), `Limpar e continuar` (secundária, com resumo de handoff) e `Restaurar último checkpoint` (texto, cor de erro). As duas primeiras preparam o pedido de continuação no composer.
- Painel de git da sessão mostra só os arquivos editados por aquela sessão quando ela não tem worktree própria.
- Ditado por voz com VAD, servidor persistente e polimento Eloquent, com configuração local via Docker.

### Alterado

- Sem limite de abas abertas; abas encolhem até `100px` e o header rola na horizontal (também com a roda do mouse).
- Botões de dividir e fechar fixos na extrema direita da aba.

### Corrigido

- Janela de contexto do Claude lida de `result.modelUsage.contextWindow`: sessões com 1M (ex.: `claude-opus-5-5`) não disparam mais o circuit breaker em 180k.
- Circuit breaker de contexto agora interrompe o turno em andamento e não dispara no turno de `/compact`.
- Arquivos com acentos no nome aparecem no status de git filtrado.

## [0.8.1] - 2026-11-15

### Alterado

- Seletor de idioma e opções gerais movidos para a aba `Geral` nas configurações.
- Tradução completa da interface do renderer (`pt-BR` e `en-US`), incluindo feedbacks, alertas, modais, tooltips, inspetor, comandos e telas de sessão, preservando termos técnicos em inglês (`handoff`, `worktree`, `workspace`, `provider`, `prompt`, `tokens`, `diff`, `MCP`, `CLI`, `skills`, `plugins`, `sandbox`, `circuit breaker`, `failover`).

## [0.8.0] - 2026-11-15

### Adicionado

- Base de internacionalização (`pt-BR` e `en-US`) em `Settings['appearance'].locale` (`auto`, `pt-BR`, `en-US`) com seletor na aba Aparência, detecção por idioma do sistema e sincronização de `document.documentElement.lang`.
- Toggle `Aa` na barra de busca para alternar diferenciação de maiúsculas/minúsculas.
- Alerta de failover automático com escolha explícita entre migrar para o novo modelo ou permanecer no modelo atual.
- Modais de confirmação antes de reverter alterações de trabalho e antes de limpar worktrees.
- Cartões de ferramenta (`ToolCard`) expansíveis também na visão de comparação lado a lado (`CompareView`).
- Histórico dos últimos 20 alertas no rodapé (`Footer`) com popover datado e ação de limpeza.
- Seção recolhível `Memória fixada` com badge `Definida` no inspetor da sessão (`SessionDetails`).
- Menus `⋯` sempre visíveis e navegáveis por teclado para ações de projetos e sessões na barra lateral (`Sidebar`).

### Corrigido

- Acessibilidade de teclado em modais (`useDialogFocus` com foco inicial e retorno de foco), `tablist` horizontais e `PlatformSelect`.
- Contraste de badges (`--on-accent`), legibilidade tipográfica mínima (`11px`), tokens de sombra/tooltip e suporte a `prefers-reduced-motion: reduce`.

## [0.7.2] - 2026-11-15

### Corrigido

- Modal "Configurar conta" ampliado para `720px` (`.modal-card.capabilities-card`) com barra de abas e campo de busca travados na mesma linha.

## [0.7.1] - 2026-11-15

### Corrigido

- Abas do modal "Configurar conta" (`Skills`, `Conectores`, `Plugins`) agora permanecem em uma linha única com rolagem horizontal quando necessário, alinhadas ao campo de filtro.
- Padrão global `white-space: nowrap` aplicado aos botões de ação, abas, filtros e pílulas do desktop (`styles.css` e `tokens.css`), mantendo `.btn-multiline` e cartões descritivos isolados.

## [0.7.0] - 2026-11-15

### Adicionado

- Botão "Revisar diff (adversarial)" na aba `Git` do inspetor e comando na paleta para abrir sub-sessão isolada somente-leitura usando outra conta ou provedor.
- Painel "Custos e tokens" na aba `Contexto` do inspetor com gasto em USD e tokens (entrada, saída e cache) por sessão, total do projeto e detalhamento por turno, persistidos localmente em `store.json`.

## [0.6.3] - 2026-11-15

### Adicionado

- Engrenagem em cada conta de "Contas e providers". Ela abre um modal para ligar ou desligar skills, MCPs, conectores e plugins da conta.
- No Claude, cada item mostra o custo em tokens. O modal também mostra o custo real dos MCPs da conta.
- Cada item indica onde a mudança vale: "Só no Inova", "Na conta" ou "Global".
- No OpenCode, a mudança pede confirmação. Ela afeta todas as contas OpenCode.

## [0.6.2] - 2026-11-14

### Adicionado

- Chat rico com cartões especializados por ferramenta (`edit`, `shell`, `lookup`, `todo` e genérico), bloco recolhível de raciocínio, estado vazio com chips de início rápido e barra de status viva com cronômetro.
- Topo unificado com abas integradas no cabeçalho, cabeçalho de sessão em linha única, trilho lateral fixo e inspector lateral acoplável com abas (`Contexto`, `Git`, `Subagentes` e `Sessão`).
- Aba `Git` no inspector e modal de diff dividido por arquivo/hunk com reversão granular por arquivo ou em lote.
- Paleta de comandos (`⌘P` / `Ctrl+P` e botão `Comandos` no topo) para navegar entre sessões, abrir novas sessões em projetos e trocar modelo, modo ou visão.
- Ao clicar em "Reiniciar para atualizar", um cartão com barra de progresso mostra cada etapa da instalação (preparar, atualizar o Homebrew, baixar e instalar, finalizar, reiniciar).

### Alterado

- Caixa de entrada na barra lateral redesenhada com cabeçalho compacto, contadores nos filtros, destaque de severidade/leitura nos cartões e badge de mensagens não lidas no trilho recolhido.

## [0.6.1] - 2026-11-14

### Adicionado

- Painel de contexto: o expansor "O que consumiu o contexto" mostra os tokens por categoria (prompt de sistema, ferramentas, MCP, memória, skills, mensagens). Ele também lista cada item, do maior para o menor. Funciona só em sessões Claude e não altera a sessão.
- O consumo de cada conta logada é atualizado a cada 1 minuto. Se uma atualização automática falhar, a barra mantém o último valor lido.

## [0.6.0] - 2026-11-14

### Adicionado

- Botão "Reiniciar para atualizar" no topo, ao lado da engrenagem, quando há versão nova. Ele instala a atualização pelo Homebrew e reinicia o app na versão nova. Se houver sessão executando, o app pede confirmação antes.
- O app verifica se há versão nova a cada 15 minutos, em vez de a cada 6 horas.
- Painel de contexto da sessão pode ser minimizado. A escolha fica salva.

### Alterado

- Painel de contexto flutua sobre a conversa e não ocupa mais espaço fixo à direita. O botão de fechar a sessão fica na borda direita.
- Configurações → Modelos: cada provedor mostra Modelo, Esforço e Modo em linhas separadas, com uma descrição curta em cada uma.
- Botões de ícone (como o X de fechar) não têm mais borda.

## [0.5.5] - 2026-11-14

### Corrigido

- Checkpoints do git não derrubam mais o processo quando o `git` termina antes de ler toda a lista de arquivos. Esse erro também fazia o build da v0.5.4 falhar.

## [0.5.4] - 2026-11-14

### Alterado

- Campo de mensagem com o agente trabalhando: mostra só o botão de parar. Ao digitar ou ditar algo, ele vira o botão de enviar, que adiciona a mensagem à fila. Depois de enfileirar, volta a ser o botão de parar.
- Parar a resposta atual envia o próximo item da fila, em vez de pausar a fila.

### Corrigido

- Gemini (Antigravity): o login de cada conta fica só no diretório da conta. O app não usa mais o Keychain do macOS, e o diálogo "Keychain Not Found" não aparece mais a cada renovação do token.
- Gemini: "Renovar login" sempre abre a página do Google e pede o código. Se você cancelar, o login anterior volta.
- Gemini: a tela de login não trava mais na versão nova do `agy`, e o link completo de autenticação aparece no modal.
- Conta com login revogado (por exemplo, depois de `/logout` no Claude Code) aparece como "sessão expirada" em Contas e no rodapé, com o botão "Renovar login". O aviso do turno com erro diz qual conta precisa de login novo.

## [0.5.3] - 2026-11-14

### Adicionado

- Abas de sessão: até 3 sessões abertas ao mesmo tempo.
- Botão de retroceder nas suas mensagens: desfaz o turno, os arquivos editados e a memória do agente, e devolve o texto ao campo de mensagem.
- Copiar, reagir e regerar nas respostas do agente.
- Comandos `/` nativos de cada provedor, como `/clear` e `/compact` no Claude.
- Skills chamadas com `/nome` aparecem como tag na mensagem enviada.
- Menu lateral recolhível, com barra flutuante de ícones.
- Fila de mensagens por sessão: mensagens enviadas enquanto o agente trabalha são enviadas uma por vez ao fim de cada resposta, com contagem visível.
- Conta no limite de uso volta a funcionar sozinha: ao enviar depois do horário de reset, o app confere e sincroniza o uso.

### Alterado

- Painel da sessão flutua sobre o conteúdo e ocupa só a altura necessária.
- Suas mensagens ficam à direita, com hora e ações embaixo.

## [0.5.2] - 2026-11-13

### Adicionado

- Notificação de nova versão, com aviso no app e no sistema.
- Versão do app e changelog dentro do app, com novidades exibidas após cada atualização.
- Botão de anexos no chat para fotos, documentos e pastas.
- Modelo, esforço e modo padrão por provedor nas configurações.
- Campo de mensagem com formatação visível enquanto você digita, como no Slack.
- Subagentes em execução e uso do contexto no painel da sessão.
- Configurações do projeto, com automação de worktree e comandos de verificação.
- Onda de áudio e botão de gravação durante o ditado.

### Alterado

- Sem a opção "Padrão" de esforço: a sessão usa o esforço das configurações (Médio por padrão).
- Painel da sessão mais enxuto, sem dados de conta e de sessão repetidos.
- Botão de parar redesenhado.

### Corrigido

- Arquivos com espaço no caminho aparecem como uma tag só e chegam inteiros ao agente.
- Texto de subagentes não aparece mais no chat principal.

## [0.5.1] - 2026-11-13

### Adicionado

- Limites de uso por modelo para Claude, Codex e Antigravity.

## [0.5.0] - 2026-11-13

### Adicionado

- Janela de configurações com atalhos globais e troca de tema claro ou escuro.
- Ditado por voz local no campo de mensagem, com catálogo de modelos para baixar, trocar e remover.
- Importação de sessões externas do Claude e do Codex pela barra lateral.
- Arrastar arquivos para o chat para anexá-los como menções.
- Turnos finalizados ficam recolhidos no chat.
- Notificações do sistema configuráveis e arquivamento automático de sessões.
- Rodapé com uso e reset separados por provedor e cartões de conta recolhíveis.

### Corrigido

- Notificações bloqueadas agora são informadas, com alternativa via osascript no macOS.
- Textos de notificação que começam com opção de linha de comando agora aparecem corretamente.
- O seletor de modo padrão só abre ao clicar no próprio seletor.

## [0.4.2] - 2026-11-13

### Alterado

- Contas aparecem em coluna única, com detalhes adaptados à largura da janela.

## [0.4.1] - 2026-11-13

### Corrigido

- Removido o piscar ao passar o mouse e alinhada a altura de campos e botões.

## [0.4.0] - 2026-11-13

### Adicionado

- Autocomplete de arquivos com `@` e paleta de comandos com `/` no campo de mensagem.
- Seletor de modo de execução por provedor.
- Git worktrees, checkpoints e verificação automática após cada turno.
- Caixa de entrada, fila de turnos, troca de conta, transferência e bifurcação de sessões.
- Comparação paralela entre provedores e sincronização unificada de perfis.
- Tabela de contas centralizada, com tags de arquivo em destaque.

### Corrigido

- A seleção do autocomplete se mantém ao usar as setas para cima e para baixo.
- Ajustes nos fluxos de revisão, checkpoints e interface dos workflows.
- Metadados de pacote Linux para gerar o `.deb`.

## [0.3.1] - 2026-11-13

### Alterado

- Ajustes internos no processo de publicação de versões.

## [0.3.0] - 2026-11-13

### Alterado

- Atualização de versão com melhorias de empacotamento.

## [0.2.0] - 2026-11-13

### Adicionado

- Suporte a vários provedores e nova interface.
- Terminal multiplataforma com ícones.

### Corrigido

- Instalação via Homebrew sem opções obsoletas.
- Sequências de controle do terminal no Windows.

## [0.1.0] - 2026-11-12

### Adicionado

- Primeira versão do Inova IDE para macOS, com interface própria.
- Sessões de chat por projeto, em árvore, com arquivar, renomear e excluir.
- Realce de código nas respostas e leitura de sessões arquivadas.
- Rodapé com uso dos provedores e restauração do espaço de trabalho.
- Instalador DMG e instalação via Homebrew.
- CLI com `--version` e `--help`.
