#!/usr/bin/env node
import { gh, ghJson } from './gh.mjs';
import { LABELS } from './policy.mjs';

const REVIEW_RULESET_NAME = 'main';
const DEV_FLOW_RULESET_NAME = 'main-dev-flow';
const REQUIRED_CHECKS = [
  'PR policy',
  'verify (macos-15)',
  'verify (ubuntu-latest)',
  'verify (windows-latest)',
];

const LABEL_DEFINITIONS = [
  {
    name: LABELS.demand,
    color: '5319e7',
    description: 'Demanda planejada. Agrupa as tarefas como sub-issues.',
  },
  {
    name: LABELS.task,
    color: '0e8a16',
    description: 'Tarefa de uma demanda. Cada tarefa tem uma branch e um PR.',
  },
  {
    name: LABELS.contractChangeApproved,
    color: 'b60205',
    description: 'Autoriza o PR a alterar testes de contrato. Só o dono do produto aplica.',
  },
];

const DEV_FLOW_RULESET = {
  name: DEV_FLOW_RULESET_NAME,
  target: 'branch',
  enforcement: 'active',
  bypass_actors: [],
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ['merge'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: REQUIRED_CHECKS.map((context) => ({ context })),
      },
    },
  ],
};

function labelActions(repository) {
  return LABEL_DEFINITIONS.map(({ name, color, description }) => ({
    description: `Criar ou atualizar a label "${name}"`,
    args: [
      'label',
      'create',
      name,
      '--color',
      color,
      '--description',
      description,
      '--force',
      '--repo',
      repository,
    ],
  }));
}

function reviewRulesetActions(repository, rulesets) {
  const summary = rulesets.find((ruleset) => ruleset.name === REVIEW_RULESET_NAME);
  if (!summary) return [];
  const ruleset = ghJson(['api', `repos/${repository}/rulesets/${summary.id}`]);
  const actors = ruleset.bypass_actors ?? [];
  if (actors.every((actor) => actor.bypass_mode === 'pull_request')) return [];
  const body = {
    bypass_actors: actors.map((actor) => ({ ...actor, bypass_mode: 'pull_request' })),
  };
  return [
    {
      description: `Ruleset "${REVIEW_RULESET_NAME}": bypass só por PR (sem push direto)`,
      args: [
        'api',
        '--method',
        'PUT',
        `repos/${repository}/rulesets/${summary.id}`,
        '--input',
        '-',
      ],
      body,
    },
  ];
}

function devFlowRulesetAction(repository, rulesets) {
  const existing = rulesets.find((ruleset) => ruleset.name === DEV_FLOW_RULESET_NAME);
  const [method, path, verb] = existing
    ? ['PUT', `repos/${repository}/rulesets/${existing.id}`, 'Atualizar']
    : ['POST', `repos/${repository}/rulesets`, 'Criar'];
  return {
    description: `${verb} o ruleset "${DEV_FLOW_RULESET_NAME}" (sem bypass): PR obrigatório e checks ${REQUIRED_CHECKS.join(', ')}`,
    args: ['api', '--method', method, path, '--input', '-'],
    body: DEV_FLOW_RULESET,
  };
}

function main() {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== '--apply')) {
    throw new Error('Usage: node scripts/dev-flow/setup-github.mjs [--apply]');
  }
  const apply = flags.includes('--apply');
  const repository = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
  const rulesets = ghJson(['api', `repos/${repository}/rulesets`]);
  const actions = [
    ...labelActions(repository),
    ...reviewRulesetActions(repository, rulesets),
    devFlowRulesetAction(repository, rulesets),
  ];
  for (const action of actions) {
    console.log(`${apply ? 'Aplicando' : 'Plano'}: ${action.description}`);
    if (apply) gh(action.args, action.body ? JSON.stringify(action.body) : undefined);
  }
  if (!apply) console.log(`\nNada foi alterado em ${repository}. Rode com --apply para aplicar.`);
}

main();
