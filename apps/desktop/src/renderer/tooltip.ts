import { SHORTCUTS, formatBinding, type ShortcutId } from './shortcuts';

export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipPlacementInput {
  anchor: TooltipRect;
  tooltip: TooltipSize;
  viewport: TooltipSize;
  gap?: number;
  margin?: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  side: 'top' | 'bottom';
}

export interface TooltipContent {
  text: string;
  keys: string | null;
}

export interface TooltipSource {
  tooltip: string | undefined;
  shortcut: string | undefined;
  shortcutText: string | undefined;
}

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 8;

export function computeTooltipPlacement(input: TooltipPlacementInput): TooltipPlacement {
  const { anchor, tooltip, viewport } = input;
  const gap = input.gap ?? DEFAULT_GAP;
  const margin = input.margin ?? DEFAULT_MARGIN;
  const fitsAbove = anchor.top - gap - tooltip.height >= margin;
  const side = fitsAbove ? 'top' : 'bottom';
  const top = fitsAbove ? anchor.top - gap - tooltip.height : anchor.top + anchor.height + gap;
  const centered = anchor.left + anchor.width / 2 - tooltip.width / 2;
  const maxLeft = Math.max(margin, viewport.width - tooltip.width - margin);
  const left = Math.min(Math.max(centered, margin), maxLeft);
  return { left, top, side };
}

function isShortcutId(value: string): value is ShortcutId {
  return SHORTCUTS.some((item) => item.id === value);
}

export function resolveTooltipContent(
  source: TooltipSource,
  isMac: boolean,
): TooltipContent | null {
  const text = source.tooltip?.trim();
  if (text === undefined || text === '') return null;
  const literal = source.shortcutText?.trim();
  if (literal !== undefined && literal !== '') return { text, keys: literal };
  if (source.shortcut === undefined || !isShortcutId(source.shortcut)) return { text, keys: null };
  const id = source.shortcut;
  const def = SHORTCUTS.find((item) => item.id === id);
  return { text, keys: def === undefined ? null : formatBinding(def.binding, isMac) };
}
