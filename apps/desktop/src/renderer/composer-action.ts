export type ComposerPrimaryAction = 'send' | 'enqueue' | 'stop';

export function composerPrimaryAction(input: {
  running: boolean;
  hasContent: boolean;
  canEnqueue: boolean;
}): ComposerPrimaryAction {
  if (!input.running) return 'send';
  return input.hasContent && input.canEnqueue ? 'enqueue' : 'stop';
}
