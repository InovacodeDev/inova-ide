import type { VerificationCheck } from '@inova/core/types';

const LABEL_MAX_LENGTH = 28;

export function toggleCheck(input: {
  checks: VerificationCheck[];
  id: string;
}): VerificationCheck[] {
  return input.checks.map((check) =>
    check.id === input.id ? { ...check, enabled: !check.enabled } : check,
  );
}

export function removeCheck(input: {
  checks: VerificationCheck[];
  id: string;
}): VerificationCheck[] {
  return input.checks.filter((check) => check.id !== input.id);
}

export function addCustomCheck(input: {
  checks: VerificationCheck[];
  command: string;
  id: string;
}): VerificationCheck[] {
  const command = input.command.trim();
  if (command === '') return input.checks;
  return [
    ...input.checks,
    { id: input.id, label: command.slice(0, LABEL_MAX_LENGTH), command, enabled: true },
  ];
}
