const CLAUDE_WINDOW = 200_000;
const CLAUDE_LONG_WINDOW = 1_000_000;

export function contextWindowFor(model: string | null): number | null {
  if (model === null) return null;
  const id = model.toLowerCase();
  if (id.includes('[1m]')) return CLAUDE_LONG_WINDOW;
  return id.startsWith('claude') ? CLAUDE_WINDOW : null;
}
