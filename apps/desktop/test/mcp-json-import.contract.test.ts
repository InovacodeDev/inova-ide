import { describe, expect, test } from 'vitest';
import { validateLibraryItem } from '@inova/core/library/validate';
import {
  parseMcpJson,
  type ImportEntry,
  type ImportEntryOk,
} from '../src/renderer/mcp-json-import';

function entriesOf(text: string, options?: Parameters<typeof parseMcpJson>[1]): ImportEntry[] {
  const result = parseMcpJson(text, options);
  if (!result.ok) throw new Error(`parse failed: ${result.error}`);
  return result.entries;
}

function okEntry(entry: ImportEntry | undefined): ImportEntryOk {
  if (!entry?.ok) throw new Error(`expected an ok entry, got ${JSON.stringify(entry)}`);
  return entry;
}

function acceptedByCore(entry: ImportEntryOk): boolean {
  return validateLibraryItem({
    ...entry.input,
    source: 'created',
    updatedAt: '2026-11-24T00:00:00.000Z',
  }).ok;
}

describe('MCP JSON import shapes', () => {
  test('mcpServers with one HTTP server becomes a connector', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } },
      }),
    );
    const ok = okEntry(entry);
    expect(ok).toMatchObject({
      id: 'linear',
      kind: 'connector',
      input: {
        kind: 'connector',
        id: 'linear',
        label: 'linear',
        definition: { type: 'http', url: 'https://mcp.linear.app/mcp' },
      },
      replacements: [],
    });
    expect(acceptedByCore(ok)).toBe(true);
  });

  test('mcpServers with a stdio server becomes an mcp item', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: { fs: { command: 'npx', args: ['-y', 'server-filesystem', '/tmp'] } },
      }),
    );
    const ok = okEntry(entry);
    expect(ok.input).toMatchObject({
      kind: 'mcp',
      definition: { command: 'npx', args: ['-y', 'server-filesystem', '/tmp'] },
    });
    expect(acceptedByCore(ok)).toBe(true);
  });

  test('the servers (VS Code) and mcp.servers wrappers are accepted', () => {
    const server = { url: 'https://example.com/mcp', type: 'http' };
    expect(okEntry(entriesOf(JSON.stringify({ servers: { a: server } }))[0]).id).toBe('a');
    expect(okEntry(entriesOf(JSON.stringify({ mcp: { servers: { b: server } } }))[0]).id).toBe('b');
  });

  test('many servers give one result per server', () => {
    const entries = entriesOf(
      JSON.stringify({
        mcpServers: {
          one: { url: 'https://one.example.com/mcp' },
          two: { command: 'node', args: ['server.js'] },
          three: { type: 'sse', url: 'https://three.example.com/sse' },
        },
      }),
    );
    expect(entries.map((entry) => entry.id)).toEqual(['one', 'two', 'three']);
    expect(entries.every((entry) => entry.ok)).toBe(true);
    expect(entries.map((entry) => (entry.ok ? entry.kind : null))).toEqual([
      'connector',
      'mcp',
      'connector',
    ]);
    expect(okEntry(entries[2]).input).toMatchObject({ definition: { type: 'sse' } });
  });

  test('a single named entry is accepted', () => {
    const [entry] = entriesOf(JSON.stringify({ notion: { url: 'https://mcp.notion.com/mcp' } }));
    expect(okEntry(entry)).toMatchObject({ id: 'notion', kind: 'connector' });
  });

  test('a single unnamed server asks for a name, then uses it as the id', () => {
    const text = JSON.stringify({ type: 'http', url: 'https://example.com/mcp' });
    expect(parseMcpJson(text)).toEqual({ ok: true, needsName: true, entries: [] });
    const [entry] = entriesOf(text, { name: 'my-server' });
    expect(okEntry(entry)).toMatchObject({ id: 'my-server', kind: 'connector' });
  });

  test('a single unnamed stdio server is accepted with a name', () => {
    const [entry] = entriesOf(JSON.stringify({ command: 'uvx', args: ['tool'] }), {
      name: 'tool',
    });
    expect(okEntry(entry)).toMatchObject({ id: 'tool', kind: 'mcp' });
  });

  test('serverUrl and streamable-http map to an http connector', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: { x: { type: 'streamable-http', serverUrl: 'https://x.dev/mcp' } },
      }),
    );
    expect(okEntry(entry).input).toMatchObject({
      definition: { type: 'http', url: 'https://x.dev/mcp' },
    });
  });
});

describe('MCP JSON import secrets', () => {
  test('a literal Authorization header becomes a ${ID_TOKEN} reference and is reported', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: {
          sentry: {
            url: 'https://mcp.sentry.dev/mcp',
            headers: { Authorization: 'Bearer sntrys_abcdefghijklmnop1234567890' },
          },
        },
      }),
    );
    const ok = okEntry(entry);
    expect(ok.input).toMatchObject({
      definition: { headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' } },
    });
    expect(ok.replacements).toEqual([
      { scope: 'header', key: 'Authorization', variable: 'SENTRY_TOKEN' },
    ]);
    expect(JSON.stringify(ok.input)).not.toContain('sntrys_');
    expect(acceptedByCore(ok)).toBe(true);
  });

  test('a literal env value becomes a reference named after the env key', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: {
          gh: {
            command: 'npx',
            args: ['-y', 'github-mcp'],
            env: { GITHUB_TOKEN: `ghp_${'a'.repeat(36)}`, REGION: '${REGION}' },
          },
        },
      }),
    );
    const ok = okEntry(entry);
    expect(ok.input).toMatchObject({
      definition: { env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', REGION: '${REGION}' } },
    });
    expect(ok.replacements).toEqual([
      { scope: 'env', key: 'GITHUB_TOKEN', variable: 'GITHUB_TOKEN' },
    ]);
    expect(JSON.stringify(ok.input)).not.toContain('ghp_');
    expect(acceptedByCore(ok)).toBe(true);
  });

  test('values that already are references are kept untouched', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: {
          flow: {
            url: 'https://flow.example.com/mcp',
            headers: { Authorization: 'Bearer ${INOVA_FLOW_TOKEN}' },
          },
        },
      }),
    );
    const ok = okEntry(entry);
    expect(ok.replacements).toEqual([]);
    expect(ok.input).toMatchObject({
      definition: { headers: { Authorization: 'Bearer ${INOVA_FLOW_TOKEN}' } },
    });
  });

  test('a literal secret in args blocks the entry instead of saving it', () => {
    const [entry] = entriesOf(
      JSON.stringify({
        mcpServers: { bad: { command: 'npx', args: ['--api-key', 'abcdef1234567890xyz'] } },
      }),
    );
    expect(entry).toMatchObject({ ok: false, error: 'secret-literal' });
  });
});

describe('MCP JSON import errors', () => {
  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['{not json', 'invalid-json'],
    ['[]', 'unknown-shape'],
    ['"text"', 'unknown-shape'],
    ['{"mcpServers": {}}', 'empty'],
    ['{"hello": "world"}', 'unknown-shape'],
  ])('%j is rejected with %s', (text, error) => {
    expect(parseMcpJson(text)).toEqual({ ok: false, error });
  });

  test('entries report missing url, missing command and bad ids', () => {
    const entries = entriesOf(
      JSON.stringify({
        mcpServers: {
          nourl: { type: 'http' },
          nocmd: { type: 'stdio' },
          '!!!': { url: 'https://example.com/mcp' },
        },
      }),
    );
    expect(entries.map((entry) => (entry.ok ? 'ok' : entry.error))).toEqual([
      'url-missing',
      'command-missing',
      'id-invalid',
    ]);
  });

  test('an id that exists in the library is reported as a duplicate', () => {
    const [entry] = entriesOf(
      JSON.stringify({ mcpServers: { linear: { url: 'https://l.dev/mcp' } } }),
      {
        existingIds: ['linear'],
      },
    );
    expect(entry).toMatchObject({ ok: false, error: 'duplicate-id', detail: 'library' });
  });
});
