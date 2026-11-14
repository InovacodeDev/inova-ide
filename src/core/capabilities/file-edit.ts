import { createHash } from 'node:crypto';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class CapabilityFileError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = 'CapabilityFileError';
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}

export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.inova.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

export async function backupFile(input: { file: string; backupRoot: string }): Promise<void> {
  await mkdir(input.backupRoot, { recursive: true, mode: 0o700 });
  const safeName = input.file.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const digest = createHash('sha1').update(input.file).digest('hex').slice(0, 8);
  try {
    await copyFile(input.file, join(input.backupRoot, `${digest}_${safeName}`));
  } catch (error: unknown) {
    if (isMissingFile(error)) return;
    throw error;
  }
}
