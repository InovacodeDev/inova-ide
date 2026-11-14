# Changelog

Todas as mudanças relevantes do Inova IDE ficam neste arquivo.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [Não lançado]

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
