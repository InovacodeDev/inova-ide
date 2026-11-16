const CLAUDE_LONG_WINDOW = 1_000_000;

const reportedWindows = new Map<string, number>();

function modelKey(model: string): string {
  return model.toLowerCase();
}

export function rememberContextWindow(input: { model: string; windowTokens: number }): void {
  if (!Number.isFinite(input.windowTokens) || input.windowTokens <= 0) return;
  reportedWindows.set(modelKey(input.model), input.windowTokens);
}

export function contextWindowFor(model: string | null): number | null {
  if (model === null) return null;
  const id = modelKey(model);
  const reported = reportedWindows.get(id);
  if (reported !== undefined) return reported;
  return id.includes('[1m]') ? CLAUDE_LONG_WINDOW : null;
}
