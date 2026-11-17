import { CapabilityFileError } from '../capabilities/file-edit.js';

export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigParseError';
  }
}

export function isFileSystemError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, syscall } = error as { code?: unknown; syscall?: unknown };
  return typeof code === 'string' && typeof syscall === 'string';
}

export function isUnreadableConfigError(error: unknown): boolean {
  return (
    error instanceof ConfigParseError ||
    error instanceof CapabilityFileError ||
    isFileSystemError(error)
  );
}
