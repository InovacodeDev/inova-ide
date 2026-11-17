export interface FindTextMatchesInput {
  text: string;
  query: string;
}

export interface FilterSheetRowsInput {
  rows: readonly string[][];
  query: string;
}

export interface FilteredSheetRow {
  rowIndex: number;
  cells: string[];
}

export function spreadsheetColumnLabel(index: number): string {
  let current = index;
  let label = '';
  while (current >= 0) {
    label = String.fromCharCode(65 + (current % 26)) + label;
    current = Math.floor(current / 26) - 1;
  }
  return label;
}

export function findTextMatches(input: FindTextMatchesInput): number[] {
  const trimmed = input.query.trim();
  if (trimmed.length === 0) return [];
  const lowerQuery = trimmed.toLowerCase();
  const lines = input.text.split(/\r?\n/);
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.toLowerCase().includes(lowerQuery)) {
      matches.push(i);
    }
  }
  return matches;
}

export function filterSheetRows(input: FilterSheetRowsInput): FilteredSheetRow[] {
  const trimmed = input.query.trim().toLowerCase();
  const results: FilteredSheetRow[] = [];
  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const cells = row ? [...row] : [];
    if (trimmed.length === 0) {
      results.push({ rowIndex: i + 1, cells });
      continue;
    }
    const matches = cells.some((cell) => cell.toLowerCase().includes(trimmed));
    if (matches) {
      results.push({ rowIndex: i + 1, cells });
    }
  }
  return results;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, 0.25), 4);
}
