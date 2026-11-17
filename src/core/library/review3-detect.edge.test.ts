import { describe, expect, it } from 'vitest';
import { containsSecretLiteral, containsSecretShape, validateLibraryItem } from './validate.js';

const GITHUB = `ghp_${'a1B2'.repeat(9)}`;

function mcp(overrides: Record<string, unknown>): unknown {
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

function withArgs(args: string[]): boolean {
  return validateLibraryItem(mcp({ definition: { command: 'npx', args } })).ok;
}

function withUrl(url: string): boolean {
  return validateLibraryItem(
    mcp({ kind: 'connector', label: 'Remote', definition: { type: 'http', url } }),
  ).ok;
}

function withDescription(description: string): boolean {
  return validateLibraryItem(mcp({ description })).ok;
}

describe('containsSecretShape only flags unambiguous secret forms', () => {
  it.each([
    GITHUB,
    `github_pat_${'A1'.repeat(15)}`,
    `sk-ant-api03-${'x'.repeat(30)}`,
    `sk_live_${'A'.repeat(24)}`,
    `rk_live_${'A'.repeat(24)}`,
    `npm_${'A'.repeat(36)}`,
    `glpat-${'A'.repeat(20)}`,
    'xoxb-123456789012-abcdefghijkl',
    'AKIAABCDEFGHIJKLMNOP',
    `AIza${'Sy'.repeat(18)}`,
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef123456',
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    `gh​p_${'A'.repeat(36)}`,
    `ｇｈｐ_${'A'.repeat(36)}`,
    `https://x.example/%67hp_${'A'.repeat(36)}/mcp`,
  ])('detects %s', (text) => {
    expect(containsSecretShape(text)).toBe(true);
  });

  it.each([
    'api_key = os.environ["DEMO_API_KEY"]',
    'const token = process.env.GH_TOKEN;',
    'items = sorted(items, key=lambda i: i.name)',
    'token = tokenizer.encode(text)',
    'headers = {"Authorization": f"Bearer {token}"}',
    'export function getKey() { const cacheKey = `${a}`; }',
    'df.groupby(key="col")',
    'API_KEY=hunter2value',
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    '-----BEGIN CERTIFICATE-----',
    'sk-short',
    'npm_short',
    'task-manager-with-a-really-long-descriptive-name',
  ])('ignores %s', (text) => {
    expect(containsSecretShape(text)).toBe(false);
  });
});

describe('containsSecretLiteral negatives that must stay valid', () => {
  it.each([
    '--sort-key=name',
    '--auth=oauth',
    '--auth none',
    '--max-tokens=100',
    '--token-limit 1000',
    '--token=${GITHUB_TOKEN}',
    '--token=<your-token>',
    'Accepts key=value pairs',
    'cacheKey=1',
    'monkey=1',
    '--password-file /etc/x',
    'x-api-key: ${API_KEY}',
    'Authorization: Bearer ${GITHUB_TOKEN}',
    'Sends a Bearer token to the API',
    'Set the Authorization header in your client',
  ])('accepts %s', (text) => {
    expect(containsSecretLiteral(text)).toBe(false);
  });

  it.each([
    '--token=ghp_abcdefghijklmnopqrstuvwxyz',
    'API_KEY=abcd1234efgh',
    '--auth=abc12345xyz',
    '--key abcdef1234567890',
    'X-Api-Key: abcdef1234567890',
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    'Authorization: Bearer abcdef1234567890',
    'GITHUB_PAT=abcdef1234567890',
    'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    `?key=%67hp_${'A'.repeat(36)}`,
  ])('rejects %s', (text) => {
    expect(containsSecretLiteral(text)).toBe(true);
  });
});

describe('validateLibraryItem against the second review forms', () => {
  it.each([
    ['--header then X-Api-Key literal', ['--header', 'X-Api-Key: abcdef1234567890']],
    ['-H then Authorization Basic', ['-H', 'Authorization: Basic dXNlcjpwYXNzd29yZA==']],
    ['--header then Authorization Bearer', ['--header', 'Authorization: Bearer abcdef1234567890']],
    ['--api_key then value', ['--api_key', 'abcdef1234567890']],
    ['--key then value', ['--key', 'abcdef1234567890']],
    ['--pat then value', ['--pat', 'abcdef1234567890']],
    ['--accessToken then value', ['--accessToken', 'abcdef1234567890']],
    ['--private-key then value', ['--private-key', 'abcdef1234567890']],
    ['--token= then value', ['--token=', 'abcdef1234567890']],
    ['--token then literal', ['--token', 'abc']],
    ['GITHUB_PAT assignment', ['GITHUB_PAT=abcdef1234567890']],
    ['npm token', [`npm_${'A'.repeat(36)}`]],
    ['gitlab token', [`glpat-${'A'.repeat(20)}`]],
    ['stripe live key', [`sk_live_${'A'.repeat(24)}`]],
    ['zero-width github token', [`gh​p_${'A'.repeat(36)}`]],
    ['fullwidth github token', [`ｇｈｐ_${'A'.repeat(36)}`]],
  ])('rejects args: %s', (_name, args) => {
    expect(withArgs(args)).toBe(false);
  });

  it.each([
    ['--sort-key=name', ['--sort-key=name']],
    ['--auth=oauth', ['--auth=oauth']],
    ['--auth none', ['--auth', 'none']],
    ['--token-limit 1000', ['--token-limit', '1000']],
    ['--max-tokens=100', ['--max-tokens=100']],
    ['--token=${VAR}', ['--token=${GITHUB_TOKEN}']],
    ['--token then reference', ['--token', '${GITHUB_TOKEN}']],
    ['--key then reference', ['--key', '${API_KEY}']],
    ['header with reference', ['--header', 'X-Api-Key: ${API_KEY}']],
    ['bearer header with reference', ['-H', 'Authorization: Bearer ${GITHUB_TOKEN}']],
  ])('accepts args: %s', (_name, args) => {
    expect(withArgs(args)).toBe(true);
  });

  it.each([
    ['percent-encoded token in the path', `https://x.example/%67hp_${'A'.repeat(36)}/mcp`],
    ['token in the path', `https://x.example/${GITHUB}/mcp`],
    ['npm token in the path', `https://x.example/npm_${'A'.repeat(36)}/mcp`],
  ])('rejects url: %s', (_name, url) => {
    expect(withUrl(url)).toBe(false);
  });

  it('accepts a plain url', () => {
    expect(withUrl('https://x.example/mcp?key=${KEY}')).toBe(true);
  });

  it.each(['key=value pairs', 'Uses --auth none by default', 'Sorts by --sort-key=name'])(
    'accepts description %s',
    (description) => {
      expect(withDescription(description)).toBe(true);
    },
  );

  it.each([`-----BEGIN PRIVATE KEY-----`, `npm_${'A'.repeat(36)}`, 'API_KEY=abcd1234efgh'])(
    'rejects description %s',
    (description) => {
      expect(withDescription(description)).toBe(false);
    },
  );

  it('never echoes the rejected value in the error', () => {
    const checked = validateLibraryItem(
      mcp({ definition: { command: 'npx', args: ['--key', 'abcdef1234567890'] } }),
    );
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.error).not.toContain('abcdef1234567890');
  });
});
