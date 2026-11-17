import { describe, expect, it } from 'vitest';
import { containsSecretLiteral, validateLibraryItem } from './validate.js';

const GITHUB = `ghp_${'a1B2'.repeat(9)}`;
const AWS = 'AKIAABCDEFGHIJKLMNOP';
const SLACK = 'xoxb-123456789012-abcdefghijkl';
const ANTHROPIC = `sk-ant-api03-${'x'.repeat(30)}`;
const GOOGLE = `AIza${'Sy'.repeat(18)}`;
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef123456';

const POSITIVES: readonly string[] = [
  GITHUB,
  `github_pat_${'A1'.repeat(15)}`,
  AWS,
  SLACK,
  ANTHROPIC,
  GOOGLE,
  JWT,
  `gho_${'z9'.repeat(12)}`,
  'Bearer abcdefgh12345678',
  'TOKEN=supersecretvalue123',
  'env TOKEN=supersecretvalue123 npx',
  'GITHUB_TOKEN = "abc"',
  'api_key = "abc"',
  'apiKey=abc123',
  '//registry.npmjs.org/:_authToken=abc123',
  'DB_PASSWORD=hunter2',
  '--api-key=abc123',
  '--token=abc123',
  '--password=abc123',
  '--auth=abc123',
  '--auth-token abc12345678',
  '--secret hunter2hunter2',
];

const NEGATIVES: readonly string[] = [
  'Servidor de notícias',
  'token efficiency',
  'Uses the --token flag to authenticate',
  'Set the API key in your environment',
  'monkey=banana',
  'hotkey=ctrl',
  'max_tokens=1024',
  '--max-tokens=100',
  '--token=${GITHUB_TOKEN}',
  '--api-key=${API_KEY}',
  'TOKEN=${GITHUB_TOKEN}',
  'export API_KEY=<your key>',
  'TOKEN=$MY_TOKEN',
  '--token ${GITHUB_TOKEN}',
  'author=Tito',
  'https://api.example.com/mcp?token=${TOKEN}',
  'sk-short',
  'ghp_short',
  'npx -y @modelcontextprotocol/server-github',
];

function base(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'demo',
    kind: 'mcp',
    name: 'Demo',
    description: null,
    enabled: true,
    source: 'created',
    updatedAt: '2026-11-17T00:00:00.000Z',
    definition: { command: 'node', args: ['server.js'] },
    ...overrides,
  };
}

function remote(definition: Record<string, unknown>): Record<string, unknown> {
  return base({
    kind: 'connector',
    label: 'Remote',
    definition: { type: 'http', url: 'https://x.example/mcp', ...definition },
  });
}

describe('containsSecretLiteral token shapes and assignments', () => {
  it.each(POSITIVES)('detects %s', (text) => {
    expect(containsSecretLiteral(text)).toBe(true);
  });

  it.each(NEGATIVES)('accepts %s', (text) => {
    expect(containsSecretLiteral(text)).toBe(false);
  });
});

describe('validateLibraryItem rejects secrets in every string of the definition', () => {
  it.each([
    ['github token in args', base({ definition: { command: 'npx', args: [GITHUB] } })],
    ['aws key in args', base({ definition: { command: 'npx', args: [AWS] } })],
    ['slack token in args', base({ definition: { command: 'npx', args: [SLACK] } })],
    [
      'flag with equals in args',
      base({ definition: { command: 'npx', args: ['--api-key=abc1'] } }),
    ],
    [
      'flag then literal in args',
      base({ definition: { command: 'npx', args: ['--token', 'abc'] } }),
    ],
    ['description token', base({ description: `token: ${GITHUB}` })],
    [
      'inline env in command',
      base({ definition: { command: 'env TOKEN=supersecretvalue123 npx' } }),
    ],
    ['url path token', remote({ url: `https://x.example/${GITHUB}/mcp` })],
    ['url query key token', remote({ url: `https://x.example/mcp?${GITHUB}=\${A}` })],
    ['connector label', { ...(remote({}) as object), label: GITHUB }],
    ['header key token', remote({ headers: { [GITHUB]: '${A}' } })],
    ['env key token', base({ definition: { command: 'npx', env: { [GITHUB]: '${A}' } } })],
    [
      'env key with assignment',
      base({ definition: { command: 'npx', env: { 'TOKEN=x Y': '${A}' } } }),
    ],
    ['env key with dash', base({ definition: { command: 'npx', env: { 'A-B': '${A}' } } })],
    ['header key with colon', remote({ headers: { 'X-Key: v': '${A}' } })],
    ['header key with newline', remote({ headers: { 'X-Key\nY': '${A}' } })],
    ['header key with space', remote({ headers: { 'X Key': '${A}' } })],
    [
      'env key over 100 chars',
      base({ definition: { command: 'npx', env: { [`A${'B'.repeat(100)}`]: '${A}' } } }),
    ],
    [
      'plugin name token',
      base({ kind: 'plugin', definition: { provider: 'claude', name: GITHUB } }),
    ],
  ])('%s', (_name, item) => {
    expect(validateLibraryItem(item).ok).toBe(false);
  });

  it.each([
    [
      'flag with variable reference',
      base({ definition: { command: 'npx', args: ['--token=${GITHUB_TOKEN}'] } }),
    ],
    [
      'flag then variable reference',
      base({ definition: { command: 'npx', args: ['--token', '${GITHUB_TOKEN}'] } }),
    ],
    [
      'flag then another flag',
      base({ definition: { command: 'npx', args: ['--token', '--verbose'] } }),
    ],
    ['plain description', base({ description: 'Servidor de notícias com token efficiency' })],
    [
      'valid env and header keys',
      remote({ headers: { 'X-Api-Key': '${A}', Authorization: 'Bearer ${A}' } }),
    ],
    [
      'env key with underscore',
      base({ definition: { command: 'npx', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } } }),
    ],
  ])('accepts %s', (_name, item) => {
    expect(validateLibraryItem(item).ok).toBe(true);
  });

  it('never echoes the rejected token in the error', () => {
    const checked = validateLibraryItem(remote({ headers: { [GITHUB]: '${A}' } }));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error).not.toContain(GITHUB);
    const pair = validateLibraryItem(
      base({ definition: { command: 'npx', args: ['--token', 'hunter2'] } }),
    );
    if (!pair.ok) expect(pair.error).not.toContain('hunter2');
  });
});
