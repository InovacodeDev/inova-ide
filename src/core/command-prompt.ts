export function expandCommandPrompt(body: string, args: string): string {
  const trimmedArgs = args.trim();
  const trimmedBody = body.trim();
  if (trimmedBody.includes('$ARGUMENTS')) {
    return trimmedBody.replaceAll('$ARGUMENTS', trimmedArgs);
  }
  if (trimmedArgs === '') return trimmedBody;
  return `${trimmedBody}\n\n${trimmedArgs}`;
}
