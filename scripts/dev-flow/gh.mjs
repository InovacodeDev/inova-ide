import { spawnSync } from 'node:child_process';

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function run(args, input) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: MAX_OUTPUT_BYTES });
  if (result.error) throw result.error;
  return result;
}

export function gh(args, input) {
  const result = run(args, input);
  if (result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function ghJson(args, input) {
  return JSON.parse(gh(args, input));
}

export function ghGraphql(query, variables) {
  const fields = Object.entries(variables).flatMap(([name, value]) =>
    typeof value === 'number' ? ['-F', `${name}=${value}`] : ['-f', `${name}=${value}`],
  );
  const result = run(['api', 'graphql', '-f', `query=${query}`, ...fields]);
  if (result.stdout.trim().length === 0) {
    throw new Error(`gh api graphql failed: ${result.stderr.trim()}`);
  }
  const { data, errors = [] } = JSON.parse(result.stdout);
  return { data, errors };
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function requireRepository() {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const [owner, repo, ...rest] = repository.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`GITHUB_REPOSITORY must be <owner>/<repo>, got "${repository}"`);
  }
  return { owner, repo };
}
