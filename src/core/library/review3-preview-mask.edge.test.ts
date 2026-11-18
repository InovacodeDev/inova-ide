import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  previewProfileSync,
  type ProfileSyncAccountInput,
  type ProfileSyncItem,
} from '../profile-sync.js';
import type { LibraryItem } from './types.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'inova-review3-mask-')));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const docs: LibraryItem = {
  id: 'docs',
  kind: 'mcp',
  name: 'docs',
  description: null,
  enabled: true,
  source: 'created',
  definition: { command: 'run-docs' },
  updatedAt: '2026-11-17T10:00:00.000Z',
};

const library = { items: [docs], projectDisabled: [] };

function account(
  provider: ProfileSyncAccountInput['provider'],
  homeDir: string,
): ProfileSyncAccountInput {
  return { id: `acc-${provider}`, provider, label: provider, homeDir };
}

function viewText(item: ProfileSyncItem | undefined): string {
  return `${item?.maskedBefore ?? ''}\n${item?.maskedAfter ?? ''}`;
}

async function codexPreview(input: { toml?: string; projectMcp?: object }) {
  const root = await tmp();
  const project = await tmp();
  const home = await tmp();
  if (input.toml !== undefined) await writeFile(join(home, 'config.toml'), input.toml);
  if (input.projectMcp) {
    await writeFile(join(project, '.mcp.json'), JSON.stringify(input.projectMcp));
  }
  const preview = await previewProfileSync({
    root,
    projectPath: project,
    accounts: [account('codex', home)],
    library,
  });
  return preview.items[0];
}

describe('the codex preview masks every value outside an allowlist', () => {
  it('masks inline, dotted, single-quoted, lowercase and commented secrets', async () => {
    const toml = [
      '[mcp_servers]',
      'inl = { command = "x", env = { K = "INLINESEC1" } }',
      '',
      '[mcp_servers.a]',
      'command = "x"',
      'env.K = "DOTTEDSEC2"',
      '# K = "COMMENTSEC6"',
      '',
      '[mcp_servers.b.env]',
      "K = 'SINGLEQSEC3'",
      'lower = "LOWERSEC4"',
      'url = "ENVURLSEC7"',
      'command = "ENVCMDSEC8"',
      '',
    ].join('\n');

    const item = await codexPreview({ toml });

    const text = viewText(item);
    for (const secret of [
      'INLINESEC1',
      'DOTTEDSEC2',
      'SINGLEQSEC3',
      'LOWERSEC4',
      'COMMENTSEC6',
      'ENVURLSEC7',
      'ENVCMDSEC8',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(item?.maskedBefore).toContain('[mcp_servers.a]\ncommand = "x"\nenv.K = "***"');
    expect(item?.maskedBefore).toContain('inl = "***"');
  });

  it('masks continuation lines of multi-line arrays and strings', async () => {
    const toml = [
      '[mcp_servers.a]',
      'command = "x"',
      'args = [',
      '  "--token",',
      '  "ARRAYSEC1",',
      ']',
      'note = """',
      'command = "MULTISEC2"',
      '"""',
      'startup_timeout_sec = 20',
      '',
    ].join('\n');

    const item = await codexPreview({ toml });

    expect(viewText(item)).not.toContain('ARRAYSEC1');
    expect(viewText(item)).not.toContain('MULTISEC2');
    expect(item?.maskedBefore).toContain('startup_timeout_sec = 20');
  });

  it('masks args, url query and headers of generated tables', async () => {
    const web = {
      type: 'http',
      url: 'https://user:URLPASS@x.example/mcp?api_key=URLSEC9&mode=fast',
      headers: { A: '${X}', B: 'LITERALHDR5' },
    };
    const cli = { command: 'npx', args: ['--header', 'Authorization: Bearer ghp_ARGSECRET0000'] };
    const item = await codexPreview({ projectMcp: { mcpServers: { web, cli } } });

    const text = viewText(item);
    for (const secret of ['LITERALHDR5', 'URLSEC9', 'URLPASS', 'ARGSECRET']) {
      expect(text).not.toContain(secret);
    }
    expect(item?.maskedAfter).toContain('[mcp_servers.web]');
    expect(item?.maskedAfter).toContain('url = "https://***@x.example/mcp?api_key=***&mode=***"');
  });
});
