// REGEX: leading /name token followed by whitespace or end, rest is the remaining arguments
const LEADING_SLASH_PATTERN = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/;

export function splitLeadingSlash(text: string): { name: string; rest: string } | null {
  const match = LEADING_SLASH_PATTERN.exec(text);
  const name = match?.[1];
  if (name === undefined) return null;
  return { name, rest: match?.[2] ?? '' };
}

export function expandCommandPrompt(body: string, args: string): string {
  const trimmedArgs = args.trim();
  const trimmedBody = body.trim();
  if (trimmedBody.includes('$ARGUMENTS')) {
    return trimmedBody.replaceAll('$ARGUMENTS', trimmedArgs);
  }
  if (trimmedArgs === '') return trimmedBody;
  return `${trimmedBody}\n\n${trimmedArgs}`;
}
