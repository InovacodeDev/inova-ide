import type { ContextInfo } from './chat-reducer';

function scaled(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded).replace('.', ',')}${unit}`;
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 999_950) return scaled(value / 1000, 'k');
  return scaled(value / 1_000_000, 'M');
}

export function contextLabel(context: ContextInfo | undefined): {
  text: string;
  percent: number | null;
} {
  if (context === undefined) return { text: '—', percent: null };
  const used = formatTokens(context.usedTokens);
  if (context.windowTokens === null || context.windowTokens <= 0) {
    return { text: used, percent: null };
  }
  const percent = Math.min(100, Math.round((context.usedTokens / context.windowTokens) * 100));
  return { text: `${used} / ${formatTokens(context.windowTokens)} · ${percent}%`, percent };
}
