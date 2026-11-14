const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeTime(input: { iso: string; now: Date }): string {
  const then = new Date(input.iso).getTime();
  if (Number.isNaN(then)) return '';
  const elapsed = input.now.getTime() - then;
  if (elapsed < MINUTE_MS) return 'agora';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h`;
  if (elapsed < 2 * DAY_MS) return 'ontem';
  return `${Math.floor(elapsed / DAY_MS)} d`;
}
