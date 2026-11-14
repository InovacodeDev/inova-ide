import { describe, expect, test } from 'vitest';
import { presentTool } from '../src/renderer/tool-presentation';

describe('presentTool', () => {
  test('builds a line-by-line diff for Edit tools', () => {
    const presented = presentTool({
      name: 'Edit',
      input: JSON.stringify({
        file_path: 'src/app.ts',
        old_string: 'const a = 1;\nconst b = 2;\nconst c = 3;',
        new_string: 'const a = 1;\nconst b = 4;\nconst d = 5;\nconst c = 3;',
      }),
      output: 'Edited successfully',
      isError: false,
    });

    expect(presented).toEqual({
      kind: 'edit',
      operation: 'edit',
      filePath: 'src/app.ts',
      addedLines: 2,
      removedLines: 1,
      diffLines: [
        { type: 'ctx', oldLine: 1, newLine: 1, text: 'const a = 1;' },
        { type: 'del', oldLine: 2, newLine: null, text: 'const b = 2;' },
        { type: 'add', oldLine: null, newLine: 2, text: 'const b = 4;' },
        { type: 'add', oldLine: null, newLine: 3, text: 'const d = 5;' },
        { type: 'ctx', oldLine: 3, newLine: 4, text: 'const c = 3;' },
      ],
    });
  });

  test('renders Write tools as full additions', () => {
    const presented = presentTool({
      name: 'Write',
      input: JSON.stringify({
        file_path: 'src/hello.ts',
        content: 'export const x = 1;\nexport const y = 2;',
      }),
      output: 'Created file',
      isError: false,
    });

    expect(presented).toEqual({
      kind: 'edit',
      operation: 'write',
      filePath: 'src/hello.ts',
      addedLines: 2,
      removedLines: 0,
      diffLines: [
        { type: 'add', oldLine: null, newLine: 1, text: 'export const x = 1;' },
        { type: 'add', oldLine: null, newLine: 2, text: 'export const y = 2;' },
      ],
    });
  });

  test('supports MultiEdit edits array', () => {
    const presented = presentTool({
      name: 'MultiEdit',
      input: JSON.stringify({
        file_path: 'src/index.ts',
        edits: [
          { old_string: 'foo', new_string: 'bar' },
          { old_string: 'baz', new_string: 'qux\nquux' },
        ],
      }),
      output: 'OK',
      isError: false,
    });

    expect(presented.kind).toBe('edit');
    if (presented.kind !== 'edit') return;
    expect(presented.addedLines).toBe(3);
    expect(presented.removedLines).toBe(2);
    expect(presented.diffLines).toHaveLength(5);
  });

  test('presents Bash and command_execution as shell tools', () => {
    const bash = presentTool({
      name: 'Bash',
      input: JSON.stringify({ command: 'pnpm test', description: 'Executa testes unitários' }),
      output: 'PASS 1\nPASS 2\n',
      isError: false,
    });
    expect(bash).toEqual({
      kind: 'shell',
      command: 'pnpm test',
      description: 'Executa testes unitários',
      output: 'PASS 1\nPASS 2\n',
      lineCount: 2,
    });

    const codex = presentTool({
      name: 'command_execution',
      input: 'bash -lc ls',
      output: '',
      isError: false,
    });
    expect(codex).toEqual({
      kind: 'shell',
      command: 'bash -lc ls',
      description: null,
      output: '',
      lineCount: 0,
    });
  });

  test('presents Read, Grep, Glob and WebSearch as compact lookup tools', () => {
    expect(
      presentTool({
        name: 'Read',
        input: JSON.stringify({ file_path: 'src/a.ts', offset: 10, limit: 25 }),
        output: 'l1\nl2\nl3',
        isError: false,
      }),
    ).toEqual({
      kind: 'lookup',
      category: 'read',
      label: 'Leitura',
      target: 'src/a.ts:10-34',
      detail: '3 linhas',
      output: 'l1\nl2\nl3',
    });

    expect(
      presentTool({
        name: 'Grep',
        input: JSON.stringify({ pattern: 'ChatEvent', path: 'src/core' }),
        output: 'src/core/chat-types.ts:66',
        isError: false,
      }),
    ).toEqual({
      kind: 'lookup',
      category: 'search',
      label: 'Busca',
      target: 'ChatEvent em src/core',
      detail: '1 correspondência',
      output: 'src/core/chat-types.ts:66',
    });

    expect(
      presentTool({
        name: 'Glob',
        input: JSON.stringify({ pattern: '**/*.tsx' }),
        output: 'a.tsx\nb.tsx',
        isError: false,
      }),
    ).toEqual({
      kind: 'lookup',
      category: 'files',
      label: 'Arquivos',
      target: '**/*.tsx',
      detail: '2 itens',
      output: 'a.tsx\nb.tsx',
    });

    expect(
      presentTool({
        name: 'WebSearch',
        input: JSON.stringify({ query: 'vitest mocking' }),
        output: 'resultado',
        isError: false,
      }),
    ).toEqual({
      kind: 'lookup',
      category: 'web',
      label: 'Web',
      target: 'vitest mocking',
      detail: '1 linha',
      output: 'resultado',
    });
  });

  test('presents TodoWrite as task checklist', () => {
    const presented = presentTool({
      name: 'TodoWrite',
      input: JSON.stringify({
        todos: [
          { content: 'Criar schema', status: 'completed' },
          { content: 'Escrever testes', status: 'in_progress' },
          { content: 'Validar build', status: 'pending' },
        ],
      }),
      output: 'Updated',
      isError: false,
    });

    expect(presented).toEqual({
      kind: 'todo',
      items: [
        { content: 'Criar schema', status: 'completed' },
        { content: 'Escrever testes', status: 'in_progress' },
        { content: 'Validar build', status: 'pending' },
      ],
      completedCount: 1,
    });
  });

  test('falls back to generic presentation with key-value pairs or raw text', () => {
    const mcp = presentTool({
      name: 'mcp_github_issue',
      input: JSON.stringify({ repo: 'inova/ide', number: 42 }),
      output: 'open',
      isError: false,
    });
    expect(mcp).toEqual({
      kind: 'generic',
      title: JSON.stringify({ repo: 'inova/ide', number: 42 }),
      result: '1 linha',
      entries: [
        { key: 'repo', value: 'inova/ide' },
        { key: 'number', value: '42' },
      ],
      rawInput: JSON.stringify({ repo: 'inova/ide', number: 42 }),
      output: 'open',
    });

    const raw = presentTool({
      name: 'CustomTool',
      input: 'raw text',
      output: null,
      isError: false,
    });
    expect(raw).toEqual({
      kind: 'generic',
      title: 'raw text',
      result: null,
      entries: [],
      rawInput: 'raw text',
      output: null,
    });
  });
});
