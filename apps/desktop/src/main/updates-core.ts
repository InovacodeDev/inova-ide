import type { Result, UpdateInfo } from '../shared/api.js';
import { fail, isRecord, ok } from './validation.js';

export const RELEASES_API_URL =
  'https://api.github.com/repos/InovacodeDev/inova-ide/releases/latest';
export const REPOSITORY_URL_PREFIX = 'https://github.com/InovacodeDev/inova-ide/';
export const UPDATE_REQUEST_TIMEOUT_MS = 10_000;

const CHECK_FAILED_MESSAGE = 'Não foi possível verificar atualizações.';
// REGEX: semver core `major.minor.patch` with an optional `-prerelease` and ignored `+build`
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string | null;
}

export interface LatestRelease {
  version: string;
  releaseUrl: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<FetchResponseLike>;

function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

function comparePrerelease(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric && Number(l) !== Number(r)) return Number(l) < Number(r) ? -1 : 1;
    if (lNumeric !== rNumeric) return lNumeric ? -1 : 1;
    if (!lNumeric && l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function isValidVersion(value: string): boolean {
  return parseVersion(value) !== null;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    const l = left.core[index] ?? 0;
    const r = right.core[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return comparePrerelease(left.prerelease, right.prerelease) < 0 ? -1 : 1;
}

export function isAllowedReleaseUrl(url: string): boolean {
  return url.startsWith(REPOSITORY_URL_PREFIX);
}

const MAX_EXTERNAL_URL = 2048;

export function parseExternalUrl(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const { url } = input;
  if (typeof url !== 'string' || url.length > MAX_EXTERNAL_URL) return undefined;
  return isAllowedReleaseUrl(url) ? url : undefined;
}

export function parseLatestRelease(json: unknown): LatestRelease | null {
  if (!isRecord(json)) return null;
  const tag = json['tag_name'];
  if (typeof tag !== 'string' || !isValidVersion(tag)) return null;
  const version = tag.trim().replace(/^v/, '');
  const htmlUrl = json['html_url'];
  const releaseUrl =
    typeof htmlUrl === 'string' && isAllowedReleaseUrl(htmlUrl)
      ? htmlUrl
      : `${REPOSITORY_URL_PREFIX}releases/tag/v${version}`;
  return { version, releaseUrl };
}

export function buildUpdateInfo(input: {
  current: string;
  latest: LatestRelease | null;
}): UpdateInfo {
  const { current, latest } = input;
  if (!latest) return { current, latest: null, available: false, releaseUrl: null };
  return {
    current,
    latest: latest.version,
    available: compareVersions(latest.version, current) > 0,
    releaseUrl: latest.releaseUrl,
  };
}

export async function fetchUpdateInfo(input: {
  current: string;
  fetch: FetchLike;
}): Promise<Result<UpdateInfo>> {
  try {
    const response = await input.fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'inova-ide' },
      signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return fail(CHECK_FAILED_MESSAGE);
    const latest = parseLatestRelease(await response.json());
    if (!latest) return fail(CHECK_FAILED_MESSAGE);
    return ok(buildUpdateInfo({ current: input.current, latest }));
  } catch (error: unknown) {
    if (error instanceof Error) return fail(CHECK_FAILED_MESSAGE);
    throw error;
  }
}
