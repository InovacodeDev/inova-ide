# Composer com autoformatação estilo Slack

Data: 2026-11-17 · Status: rascunho para aprovação · Frente 3 de 3 (ver também `ide-capability-library-design` e `ide-command-executor-design`)

## Intenção

No Slack, o usuário digita `` `texto` `` e o texto vira código na hora. O mesmo vale para `*negrito*`, `_itálico_` e `~riscado~`. O composer do Inova (`RichComposer.tsx`, `contentEditable`) só formata por atalho de teclado e pela barra. Esta spec adiciona a autoformatação por digitação.

## O que já existe (reuse)

| Peça | Onde | Uso |
| --- | --- | --- |
| `runFormat`, `toggleInlineCode`, `runBlockFormat` | `RichComposer.tsx` | Aplicam a formatação no DOM |
| `serializeMarkdown` | `rich-markdown.ts` | Converte o DOM em Markdown no envio. `<b>` vira `**x**`, `<s>` vira `~~x~~`, `<code>` vira `` `x` `` |
| `WORD_CHAR` (regra de fronteira de palavra) | `rich-markdown.ts` | Evita `snake_case` virar itálico |
| `detectComposerTrigger` | `composer-trigger.ts` | Popups de `/` (comando) e `@` (arquivo) |
| `resetBlockAtCaretStart` | `RichComposer.tsx` | Padrão de backspace que desfaz bloco |

## Decisões declaradas

1. **Gramática estilo Slack.** `*x*` vira **negrito** (não itálico). O serializador já emite `**x**` e `_x_`, então o Markdown enviado não muda.
2. **Módulo puro novo.** A detecção fica em `composer-autoformat.ts`, sem DOM, testável. Ela **não altera `matchToken`** em `rich-markdown.ts`. Motivo: `matchToken` renderiza texto Markdown já existente, onde `*x*` é itálico. Mudar a regra alteraria texto antigo.
3. **Aplicação via `execCommand`.** O DOM muda pelas funções que o arquivo já usa. Assim o `Ctrl+Z` nativo desfaz a conversão.
4. **Gatilho.** A conversão ocorre quando o usuário digita o delimitador de **fechamento**. Em seguida o texto entre os delimitadores vira o formato.

## Gramática (v1)

### Inline

| Digitação | Resultado | Formato |
| --- | --- | --- |
| `` `texto` `` | código | `code` |
| `*texto*` ou `**texto**` | negrito | `bold` |
| `_texto_` | itálico | `italic` |
| `~texto~` ou `~~texto~~` | riscado | `strike` |

### Bloco (no início da linha, ao digitar espaço)

| Digitação | Resultado |
| --- | --- |
| `- ` ou `* ` | lista com marcadores |
| `1. ` | lista numerada |
| `> ` | citação |
| ```` ``` ```` (e Enter) | bloco de código |

Títulos (`# `) ficam **fora** da v1: o Slack não os tem.

## Regras de negócio (viram contratos)

1. O delimitador de abertura vem no início da linha ou depois de espaço ou pontuação.
2. O texto interno não pode ser vazio, nem começar ou terminar com espaço.
3. `snake_case_word` e `__init__` **não** viram itálico (fronteira de palavra de `WORD_CHAR`).
4. Dentro de `code` ou `pre`, nenhuma autoformatação roda.
5. Durante composição IME (`isComposing`, `keyCode 229`, `insertCompositionText`), nenhuma autoformatação roda.
6. Colar texto continua texto puro. Colar `` `x` `` não converte.
7. `Backspace` logo depois de uma conversão devolve o texto literal, com os delimitadores. Uma conversão desfeita não volta a converter até o usuário digitar outro delimitador.
8. Um token que faz parte de um gatilho ativo de `@` ou `/`, ou que começa com `@` ou `/` (caminho de arquivo, comando), não converte. Exemplo: `@src/a_b_c.ts` mantém o texto.
9. URLs e caminhos com `_`, `*` ou `~` no meio de um token sem espaço não convertem.
10. A conversão não muda o texto fora do par de delimitadores.
11. `serializeMarkdown` de um texto convertido devolve o Markdown esperado (ida e volta: `` `x` `` → `<code>` → `` `x` ``).
12. A conversão não dispara envio nem abre popup de `/` ou `@`.

## Arquitetura

- `apps/desktop/src/renderer/composer-autoformat.ts` (puro):
  - `detectInlineAutoformat(input: { text: string; caret: number }): { format: ComposerFormat; start: number; innerStart: number; innerEnd: number; end: number } | null`
  - `detectBlockAutoformat(input: { lineText: string }): { format: ComposerFormat; consume: number } | null`
- `RichComposer.tsx`:
  - Em `onInput` (via `afterEdit`), com o tipo de entrada: se `insertText` e o caractere é um delimitador ou espaço, chame o detector com o texto do nó de texto até o caret.
  - Se houver resultado: selecione o intervalo, remova os delimitadores e aplique `toggleInlineCode`/`runFormat` pelo caminho existente.
  - Um `ref` guarda `lastAutoformat` (nó, formato, literal original). `handleKeyDown` usa o `ref` no `Backspace` (regra 7). Qualquer outra tecla limpa o `ref`.
- Sem dependência nova. Sem mudança em `serializeMarkdown`.

## Fora do escopo (v1)

- Títulos, tabelas, listas aninhadas.
- Conversão ao colar.
- Emoji `:nome:`.
- Escape manual com `\`. O `Backspace` da regra 7 cobre o desfazer.

## Riscos e pontos de atenção

- `contentEditable` + `execCommand` + IME é frágil. A regra 5 é obrigatória.
- Verifique manualmente no Electron (macOS e Windows): o `fake-dom` não reproduz seleção e `execCommand` com fidelidade.
- O desfazer nativo (`Ctrl+Z`) depende de a conversão passar por `execCommand`. Se uma versão do Electron quebrar isso, o `Backspace` (regra 7) continua válido.

## Tarefas propostas (sub-issues)

| # | Tarefa | Tipo | Depende de |
| --- | --- | --- | --- |
| 1 | Módulo puro `composer-autoformat.ts` (inline + bloco) | feat | — |
| 2 | Integração no `RichComposer` (`onInput`, `Backspace` de desfazer, guards IME e `@`/`/`) | feat | 1 |

Contratos: `composer-autoformat.contract.test.ts` (regras 1 a 3, 10, 11) e `*.edge.test.ts` (regras 4 a 9, 12; `snake_case`, caminhos, IME, bloco dentro de lista).
