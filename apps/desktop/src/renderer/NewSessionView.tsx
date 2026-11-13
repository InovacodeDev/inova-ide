import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { AccountView, ProjectView } from '../shared/api';
import { FolderIcon } from './icons';
import { PROVIDER_ORDER } from './footer-state';
import { PlatformSelect } from './PlatformSelect';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_BINARY, PROVIDER_NAME, accountDisplayName } from './provider-meta';
import './views-forms.css';

export type NewSessionTarget =
  | { kind: 'project'; project: ProjectView }
  | { kind: 'folder'; path: string; accountLabel: string };

export interface NewSessionViewProps {
  accounts: AccountView[];
  projects: ProjectView[];
  onPickFolder: () => Promise<string | null>;
  onStart: (input: {
    target: NewSessionTarget;
    prompt: string;
    isolatedWorktree?: boolean;
  }) => Promise<void>;
  onCancel: () => void;
  onManageAccounts: () => void;
}

const OTHER_FOLDER = '__other__';

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function NewSessionView(props: NewSessionViewProps) {
  const { accounts, projects, onPickFolder, onStart, onCancel, onManageAccounts } = props;
  const [choice, setChoice] = useState<string>(projects[0]?.id ?? OTHER_FOLDER);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [pickedProvider, setPickedProvider] = useState<ProviderId | null>(null);
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const [isolatedWorktreeOverride, setIsolatedWorktreeOverride] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (accounts.length === 0) {
    return (
      <div className="view-scroll">
        <div className="new-session">
          <h1>Nova sessão</h1>
          <div className="new-session-empty">
            <p>Nenhuma conta conectada.</p>
            <button type="button" className="btn btn-primary" onClick={onManageAccounts}>
              Adicionar conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  const project = projects.find((p) => p.id === choice) ?? null;
  const selectedChoice = project ? choice : OTHER_FOLDER;
  const providers = PROVIDER_ORDER.filter((id) => accounts.some((a) => a.provider === id));
  const provider: ProviderId | null =
    project?.provider ??
    (pickedProvider && providers.includes(pickedProvider) ? pickedProvider : providers[0]) ??
    null;
  const providerAccounts = accounts.filter((a) => a.provider === provider);
  const accountLabel =
    project?.accountLabel ??
    (providerAccounts.find((a) => a.label === pickedLabel) ?? providerAccounts[0])?.label ??
    null;
  const target: NewSessionTarget | null = project
    ? { kind: 'project', project }
    : folderPath && accountLabel
      ? { kind: 'folder', path: folderPath, accountLabel }
      : null;

  const pickFolder = async () => {
    const path = await onPickFolder();
    if (!path) return;
    const existing = projects.find((p) => p.path === path);
    if (existing) setChoice(existing.id);
    else setFolderPath(path);
  };

  const isolatedWorktree = isolatedWorktreeOverride ?? project?.autoWorktree ?? false;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      await onStart({ target, prompt: prompt.trim(), isolatedWorktree });
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const emailByLabel = new Map(accounts.map((a) => [a.label, a.email] as const));

  const directoryOptions = [
    ...projects.map((p) => {
      const accountDisplay = accountDisplayName({
        label: p.accountLabel,
        email: emailByLabel.get(p.accountLabel) ?? p.accountEmail,
      });
      return {
        value: p.id,
        label: `${baseName(p.path)} — ${accountDisplay}`,
        description: p.path,
        leading: <ProviderBadge provider={p.provider} size={18} />,
      };
    }),
    {
      value: OTHER_FOLDER,
      label: 'Outra pasta…',
      description: 'Escolher um diretório no computador',
      leading: <FolderIcon size={16} />,
    },
  ];

  const accountOptions = providerAccounts.map((a) => ({
    value: a.label,
    label: accountDisplayName(a),
    description: a.status === 'logged-in' ? 'Conectada' : 'Desconectada',
    leading: <ProviderBadge provider={a.provider} size={18} />,
  }));

  return (
    <div className="view-scroll">
      <form className="new-session" onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown}>
        <div>
          <h1>Nova sessão</h1>
          <p>Escolha onde o agente vai trabalhar e qual conta roda por baixo.</p>
        </div>

        <div className="new-session-group">
          <label htmlFor="new-session-dir" className="section-label">
            Diretório de trabalho
          </label>
          <PlatformSelect
            id="new-session-dir"
            ariaLabel="Diretório de trabalho"
            value={selectedChoice}
            options={directoryOptions}
            onChange={(value) => setChoice(value)}
          />
          {project ? null : (
            <div className="new-session-folder">
              <div className="new-session-path">
                <FolderIcon size={16} />
                {folderPath ? (
                  folderPath
                ) : (
                  <span className="new-session-path-empty">Nenhuma pasta escolhida</span>
                )}
              </div>
              <button type="button" className="btn" onClick={() => void pickFolder()}>
                Escolher pasta
              </button>
            </div>
          )}
        </div>

        <div className="new-session-group" role="radiogroup" aria-label="Provider">
          <span className="section-label">Provider</span>
          <div className="new-session-providers">
            {providers.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={provider === id}
                className="new-session-card"
                disabled={project !== null}
                onClick={() => {
                  setPickedProvider(id);
                  setPickedLabel(null);
                }}
              >
                <ProviderBadge provider={id} size={28} />
                <span className="new-session-card-name">{PROVIDER_NAME[id]}</span>
                <span className="new-session-card-bin">{PROVIDER_BINARY[id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="new-session-group">
          <label htmlFor="new-session-account" className="section-label">
            Conta
          </label>
          <PlatformSelect
            id="new-session-account"
            ariaLabel="Conta"
            value={accountLabel ?? ''}
            options={accountOptions}
            disabled={project !== null}
            onChange={(value) => setPickedLabel(value)}
          />
        </div>

        <div className="new-session-group">
          <label htmlFor="new-session-prompt" className="section-label">
            Primeira mensagem (opcional)
          </label>
          <textarea
            id="new-session-prompt"
            className="field"
            rows={3}
            placeholder="O que o agente deve fazer primeiro?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="new-session-group">
          <label className="new-session-check">
            <input
              type="checkbox"
              checked={isolatedWorktree}
              onChange={(e) => setIsolatedWorktreeOverride(e.target.checked)}
            />
            <span>Isolar sessão em Git worktree</span>
          </label>
        </div>

        <div className="new-session-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={target === null || submitting}
          >
            Iniciar sessão <kbd>⌘↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
