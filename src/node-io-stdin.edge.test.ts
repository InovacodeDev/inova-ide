import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { nodeRunner } from './node-io.js';

describe('nodeRunner stdin input', () => {
  it('writes input to the child stdin and closes it', async () => {
    const result = await nodeRunner.run({
      command: process.execPath,
      args: [
        '-e',
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(d.toUpperCase()))",
      ],
      env: {},
      input: 'hello\n',
    });
    expect(result).toEqual({ exitCode: 0, stdout: 'HELLO\n' });
  });

  it('still reports notFound when the binary is missing and input is given', async () => {
    const result = await nodeRunner.run({
      command: join(tmpdir(), 'inova-missing-binary-for-stdin'),
      args: [],
      env: {},
      input: 'ignored',
    });
    expect(result).toEqual({ notFound: true });
  });

  it('does not fail when the child exits before reading a large input', async () => {
    const result = await nodeRunner.run({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      env: {},
      input: 'x'.repeat(1_000_000),
    });
    expect(result).toEqual({ exitCode: 0, stdout: '' });
  });
});
