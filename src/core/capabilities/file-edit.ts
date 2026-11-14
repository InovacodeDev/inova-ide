import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) return null;
    throw error;
  }
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function updateJsonFile(input: {
  file: string;
  backupRoot: string;
  update: (root: Record<string, unknown>) => Record<string, unknown>;
}): Promise<void> {
  const raw = await readIfExists(input.file);
  let root: Record<string, unknown> = {};
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CapabilityFileError(input.file, 'invalid JSON');
    }
    if (!isPlainObject(parsed))
      throw new CapabilityFileError(input.file, 'JSON root is not an object');
    root = parsed;
  }
  await backupFile({ file: input.file, backupRoot: input.backupRoot });
  await writeAtomic(input.file, `${JSON.stringify(input.update(root), null, 2)}\n`);
}
