import { maskSecretsInText } from '../profile-sync.js';

// REGEX: zero-width characters (U+200B to U+200D, U+2060, U+FEFF)
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
// REGEX: run of percent-encoded bytes such as %67%68
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;
// REGEX: well-known token shapes (GitHub, GitHub PAT, OpenAI/Anthropic sk-, Stripe live keys, npm, GitLab, Slack, AWS key id, Google API key, JWT)
const TOKEN_SHAPE =
  /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*)/;
// REGEX: PEM private key header such as -----BEGIN RSA PRIVATE KEY-----
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
// REGEX: AWS secret access key name followed by a 40 character value
const AWS_SECRET_KEY = /aws[_-]?secret[_-]?access[_-]?key["'\s:=]+[A-Za-z0-9/+=]{40}/i;
// REGEX: optional dashes, a name, an equals sign and the value (double quoted, single quoted or bare)
const ASSIGNMENT =
  /(?<![A-Za-z0-9_-])-{0,2}([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("[^"]*"?|'[^']*'?|[^\s"']*)/g;
// REGEX: dash-prefixed flag name, whitespace, then the value (double quoted, single quoted or bare)
const FLAG_WITH_VALUE =
  /(?<![A-Za-z0-9_-])--?([A-Za-z][A-Za-z0-9_-]*)\s+("[^"]*"?|'[^']*'?|[^\s"']+)/g;
// REGEX: header name (authorization, x-api-key, api-key, x-auth-token, token), colon, optional scheme, then the value
const HEADER_LITERAL =
  /(?<![A-Za-z0-9_-])(?:authorization|x-api-key|api-key|x-auth-token|token)\s*:\s*(?:(?:Basic|Bearer|Token)\s+)?("[^"]*"?|'[^']*'?|[^\s"']+)/gi;
// REGEX: whole argument is a dash-prefixed flag name, optionally ending in an equals sign
const FLAG_ONLY = /^--?([A-Za-z][A-Za-z0-9_-]*)=?$/;
// REGEX: lowercase-to-uppercase boundary inside a camelCase name
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
// REGEX: name that ends with a secret word (api key, token, password, passwd, secret, private key, pat) after a hyphen split
const STRONG_NAME = /(?:^|-)(?:api-?key|token|password|passwd|secret|private-?key|pat)$/;
// REGEX: name that is exactly auth, authorization or key
const WEAK_NAME = /^(?:auth|authorization|key)$/;
// REGEX: value that references a variable ($VAR, ${VAR}) or a <placeholder>, optionally after a scheme word such as Bearer
const REFERENCE_VALUE = /^(?:[A-Za-z]+ )?["']?[$<]/;
const MIN_MIXED_LENGTH = 8;
const MIN_PLAIN_LENGTH = 16;

type NameStrength = 'strong' | 'weak';

const SHAPE_PATTERNS: readonly RegExp[] = [TOKEN_SHAPE, PRIVATE_KEY_PEM, AWS_SECRET_KEY];

function stripInvisible(text: string): string {
  return text.normalize('NFKC').replace(ZERO_WIDTH, '');
}

function decodePercentRuns(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function textVariants(text: string): string[] {
  const normalized = stripInvisible(text);
  const decoded = stripInvisible(decodePercentRuns(normalized));
  return decoded === normalized ? [normalized] : [normalized, decoded];
}

function nameStrength(name: string): NameStrength | null {
  const words = name
    .replace(CAMEL_BOUNDARY, '$1-$2')
    .toLowerCase()
    .replaceAll('_', '-')
    .replace(/^-+/, '');
  if (STRONG_NAME.test(words)) return 'strong';
  return WEAK_NAME.test(words) ? 'weak' : null;
}

function unquote(value: string): string {
  return value.replace(/^["']/, '').replace(/["']$/, '');
}

function isReference(value: string): boolean {
  return REFERENCE_VALUE.test(value);
}

function looksLikeSecretValue(value: string): boolean {
  if (value === '' || value.startsWith('-') || isReference(value)) return false;
  const mixed = value.length >= MIN_MIXED_LENGTH && /[A-Za-z]/.test(value) && /\d/.test(value);
  return mixed || (value.length >= MIN_PLAIN_LENGTH && !/\s/.test(value));
}

function assignsSecret(input: { name: string; value: string }): boolean {
  const strength = nameStrength(input.name);
  const value = unquote(input.value);
  if (strength === 'strong') return value !== '' && !isReference(value);
  return strength === 'weak' && looksLikeSecretValue(value);
}

function hasSecretAssignment(text: string): boolean {
  return [...text.matchAll(ASSIGNMENT)].some((match) =>
    assignsSecret({ name: match[1] ?? '', value: match[2] ?? '' }),
  );
}

function hasSecretFlagValue(text: string): boolean {
  return [...text.matchAll(FLAG_WITH_VALUE)].some(
    (match) =>
      nameStrength(match[1] ?? '') !== null && looksLikeSecretValue(unquote(match[2] ?? '')),
  );
}

function hasSecretHeader(text: string): boolean {
  return [...text.matchAll(HEADER_LITERAL)].some((match) =>
    looksLikeSecretValue(unquote(match[1] ?? '')),
  );
}

function hasSecretShape(text: string): boolean {
  return SHAPE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasSecretLiteral(text: string): boolean {
  return (
    hasSecretShape(text) ||
    maskSecretsInText(text) !== text ||
    hasSecretAssignment(text) ||
    hasSecretFlagValue(text) ||
    hasSecretHeader(text)
  );
}

export function containsSecretShape(text: string): boolean {
  return textVariants(text).some(hasSecretShape);
}

export function containsSecretLiteral(text: string): boolean {
  return textVariants(text).some(hasSecretLiteral);
}

export function isSecretFlagArgument(input: { flag: string; value: string }): boolean {
  const { flag, value } = input;
  const name = FLAG_ONLY.exec(flag)?.[1];
  const strength = name === undefined ? null : nameStrength(name);
  if (strength === null) return false;
  if (strength === 'weak') return looksLikeSecretValue(value);
  return value !== '' && !value.startsWith('-') && !isReference(value);
}
