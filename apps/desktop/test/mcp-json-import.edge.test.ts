import { describe, expect, test } from 'vitest';
import { validateLibraryItem } from '@inova/core/library/validate';
import {
  MAX_IMPORT_JSON_CHARS,
  MAX_IMPORT_SERVERS,
  normalizeServerId,
  parseMcpJson,
  type ImportEntry,
  type ImportEntryOk,
} from '../src/renderer/mcp-json-import';

function parse(value: unknown, options?: Parameters<typeof parseMcpJson>[1]) {
  return parseMcpJson(typeof value === 'string' ? value : JSON.stringify(value), options);
}

function entries(value: unknown, options?: Parameters<typeof parseMcpJson>[1]): ImportEntry[] {
  const result = parse(value, options);
  if (!result.ok) throw new Error(`parse failed: ${result.error}`);
  return result.entries;
}

function first(value: unknown, options?: Parameters<typeof parseMcpJson>[1]): ImportEntry {
  const [entry] = entries(value, options);
  if (!entry) throw new Error('no entries');
  return entry;
}

function asOk(entry: ImportEntry): ImportEntryOk {
  if (!entry.ok) throw new Error(`expected ok, got ${entry.error}`);
  return entry;
}

describe('invalid input', () => {
  test('input over the size limit is rejected without parsing', () => {
    const huge = `{"mcpServers": {"a": {"url": "https://x.dev/${'a'.repeat(MAX_IMPORT_JSON_CHARS)}"}}}`;
    expect(parseMcpJson(huge)).toEqual({ ok: false, error: 'too-large' });
  });

  test('more servers than the limit give a single too-many failure', () => {
    const servers = Object.fromEntries(
      Array.from({ length: MAX_IMPORT_SERVERS + 1 }, (_, index) => [
        `s${index}`,
        { url: 'https://x.dev/mcp' },
      ]),
    );
    const result = entries({ mcpServers: servers });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ ok: false, error: 'too-many' });
  });

  test('the exact server limit is accepted', () => {
    const servers = Object.fromEntries(
      Array.from({ length: MAX_IMPORT_SERVERS }, (_, index) => [
        `s${index}`,
        { url: 'https://x.dev/mcp' },
      ]),
    );
    expect(entries({ mcpServers: servers }).every((entry) => entry.ok)).toBe(true);
  });

  test('arrays, numbers, null and booleans as the root are unknown shapes', () => {
    for (const text of ['[{"url":"https://x.dev"}]', '42', 'null', 'true']) {
      expect(parseMcpJson(text)).toEqual({ ok: false, error: 'unknown-shape' });
    }
  });

  test('wrong types inside an entry fail only that entry', () => {
    const result = entries({
      mcpServers: {
        a: 'not-an-object',
        b: ['x'],
        c: { url: 42 },
        d: { command: 7 },
        e: { url: 'https://x.dev/mcp' },
      },
    });
    expect(result.map((entry) => (entry.ok ? 'ok' : entry.error))).toEqual([
      'not-object',
      'not-object',
      'url-missing',
      'command-missing',
      'ok',
    ]);
  });

  test('url and command together without a type is ambiguous', () => {
    expect(first({ mcpServers: { a: { url: 'https://x.dev', command: 'npx' } } })).toMatchObject({
      ok: false,
      error: 'ambiguous',
    });
  });

  test('an entry with neither url nor command is unknown', () => {
    expect(first({ mcpServers: { a: { type: 'http' }, b: { foo: 1 } } })).toMatchObject({
      ok: false,
    });
    expect(first({ mcpServers: { b: { foo: 1 } } })).toMatchObject({
      ok: false,
      error: 'unknown-server',
    });
  });

  test('unsupported transport types are reported', () => {
    expect(first({ mcpServers: { a: { type: 'websocket', url: 'wss://x.dev' } } })).toMatchObject({
      ok: false,
      error: 'unsupported-type',
      detail: 'websocket',
    });
    expect(first({ mcpServers: { a: { type: 5, url: 'https://x.dev' } } })).toMatchObject({
      ok: false,
      error: 'unsupported-type',
    });
  });

  test.each([
    ['ftp://x.dev/mcp', 'url-invalid'],
    ['not a url', 'url-invalid'],
    ['https://user:pass@x.dev/mcp', 'url-credentials'],
    ['https://x.dev/mcp#frag', 'url-invalid'],
    ['', 'url-missing'],
  ])('url %j fails with %s', (url, error) => {
    expect(first({ mcpServers: { a: { url } } })).toMatchObject({ ok: false, error });
  });

  test('args that are not a list of strings fail', () => {
    expect(first({ mcpServers: { a: { command: 'x', args: 'one' } } })).toMatchObject({
      ok: false,
      error: 'args-invalid',
    });
    expect(first({ mcpServers: { a: { command: 'x', args: [1] } } })).toMatchObject({
      ok: false,
      error: 'args-invalid',
    });
  });

  test('headers and env that are not string records fail', () => {
    expect(first({ mcpServers: { a: { url: 'https://x.dev', headers: ['a'] } } })).toMatchObject({
      ok: false,
      error: 'record-invalid',
    });
    expect(first({ mcpServers: { a: { command: 'x', env: { A: 1 } } } })).toMatchObject({
      ok: false,
      error: 'record-invalid',
    });
    expect(first({ mcpServers: { a: { command: 'x', env: { 'bad key': 'v' } } } })).toMatchObject({
      ok: false,
      error: 'record-invalid',
    });
  });

  test('a prototype pollution key in headers fails the entry', () => {
    const text = '{"mcpServers":{"a":{"url":"https://x.dev","headers":{"__proto__":"x"}}}}';
    expect(first(text)).toMatchObject({ ok: false, error: 'record-invalid' });
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });

  test('a secret in the command or in the URL path blocks the entry', () => {
    expect(
      first({ mcpServers: { a: { command: `run --token=ghp_${'a'.repeat(36)}` } } }),
    ).toMatchObject({ ok: false, error: 'secret-literal', detail: 'command' });
    expect(
      first({ mcpServers: { a: { url: `https://x.dev/${'ghp_'}${'a'.repeat(36)}/mcp` } } }),
    ).toMatchObject({ ok: false, error: 'secret-literal', detail: 'url' });
  });
});

describe('ids', () => {
  test('keys that are not slugs are normalized with a warning', () => {
    const entry = asOk(first({ mcpServers: { 'My Server_1': { url: 'https://x.dev/mcp' } } }));
    expect(entry.id).toBe('my-server-1');
    expect(entry.warnings).toContainEqual({ code: 'id-normalized', detail: 'my-server-1' });
    expect(entry.input).toMatchObject({ name: 'My Server_1' });
  });

  test('two keys that normalize to the same id give a duplicate error on the second', () => {
    const result = entries({
      mcpServers: { 'A B': { url: 'https://x.dev/1' }, 'a-b': { url: 'https://x.dev/2' } },
    });
    expect(result[0]?.ok).toBe(true);
    expect(result[1]).toMatchObject({ ok: false, error: 'duplicate-id', detail: 'json' });
  });

  test('the typed id of a single server is strict and never normalized', () => {
    const server = { url: 'https://x.dev/mcp' };
    expect(first(server, { name: 'Bad Name' })).toMatchObject({ ok: false, error: 'id-invalid' });
    expect(first(server, { name: '  good-name  ' })).toMatchObject({ ok: true, id: 'good-name' });
  });

  test('a typed id that exists in the library is a duplicate', () => {
    expect(
      first({ url: 'https://x.dev/mcp' }, { name: 'taken', existingIds: ['taken'] }),
    ).toMatchObject({
      ok: false,
      error: 'duplicate-id',
    });
  });

  test('a blank typed id keeps asking for a name', () => {
    expect(parse({ url: 'https://x.dev/mcp' }, { name: '   ' })).toEqual({
      ok: true,
      needsName: true,
      entries: [],
    });
  });

  test('normalizeServerId trims, limits the length and drops edge hyphens', () => {
    expect(normalizeServerId('  --Hello  World--  ')).toBe('hello-world');
    expect(normalizeServerId('€€€')).toBe('');
    expect(normalizeServerId('a'.repeat(100))).toHaveLength(64);
  });
});

describe('secret replacement', () => {
  test('literal non-Authorization headers get an id-scoped variable', () => {
    const entry = asOk(
      first({
        mcpServers: {
          api: { url: 'https://x.dev/mcp', headers: { 'X-Api-Key': 'abc123def456ghi789' } },
        },
      }),
    );
    expect(entry.replacements).toEqual([
      { scope: 'header', key: 'X-Api-Key', variable: 'API_X_API_KEY' },
    ]);
    expect(entry.input).toMatchObject({
      definition: { headers: { 'X-Api-Key': '${API_X_API_KEY}' } },
    });
  });

  test('a bare $VAR reference is converted to ${VAR}', () => {
    const entry = asOk(
      first({
        mcpServers: {
          a: { url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer $MY_TOKEN' } },
        },
      }),
    );
    expect(entry.input).toMatchObject({
      definition: { headers: { Authorization: 'Bearer ${MY_TOKEN}' } },
    });
    expect(entry.replacements[0]?.variable).toBe('MY_TOKEN');
  });

  test('two literal headers never share a variable name', () => {
    const entry = asOk(
      first({
        mcpServers: {
          a: {
            url: 'https://x.dev/mcp',
            headers: { 'x-key': 'one-literal-value-1', 'X-Key': 'two-literal-value-2' },
          },
        },
      }),
    );
    const names = entry.replacements.map((item) => item.variable);
    expect(new Set(names).size).toBe(2);
  });

  test('literal URL query values become references and the URL stays valid', () => {
    const entry = asOk(
      first({ mcpServers: { svc: { url: 'https://x.dev/mcp?key=abc123secret456&mode=fast' } } }),
    );
    expect(entry.target).toBe('https://x.dev/mcp?key=${SVC_KEY}&mode=${SVC_MODE}');
    expect(entry.replacements.map((item) => item.scope)).toEqual(['url', 'url']);
    expect(
      validateLibraryItem({
        ...entry.input,
        source: 'created',
        updatedAt: '2026-11-24T00:00:00.000Z',
      }).ok,
    ).toBe(true);
  });

  test('the saved input never contains the literal value, in any field', () => {
    const secret = `ghp_${'z'.repeat(36)}`;
    const entry = asOk(
      first({
        mcpServers: {
          a: {
            command: 'node',
            args: ['server.js'],
            env: { GITHUB_TOKEN: secret, OTHER: `Bearer ${secret}` },
          },
        },
      }),
    );
    expect(JSON.stringify(entry)).not.toContain(secret);
  });

  test('extra fields are ignored with a warning', () => {
    const entry = asOk(
      first({ mcpServers: { a: { url: 'https://x.dev/mcp', disabled: true, timeout: 5 } } }),
    );
    expect(entry.warnings).toContainEqual({ code: 'ignored-fields', detail: 'disabled, timeout' });
  });
});
