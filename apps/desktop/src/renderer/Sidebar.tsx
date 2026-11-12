import { useState, type FormEvent } from 'react';
import type { AuthStatus } from '@inova/core/providers';
import type { AccountView, ProjectView } from '../shared/api';

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;

const STATUS_TEXT: Record<AuthStatus, string> = {
  'logged-in': 'conectada',
  'logged-out': 'desconectada',
  'binary-missing': 'CLI não instalado',
  unknown: 'desconhecido',
};

export interface SidebarProps {
  accounts: AccountView[];
  projects: ProjectView[];
  onOpenProject: (project: ProjectView) => void;
  onAddProject: (accountLabel: string) => void;
  onUnbind: (project: ProjectView) => void;
  onLogin: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onAddAccount: (input: { provider: string; label: string }) => void;
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function ProjectsSection(props: SidebarProps) {
  const { accounts, projects, onOpenProject, onUnbind, onAddProject } = props;
  const [accountLabel, setAccountLabel] = useState('');
  const selected = accountLabel || accounts[0]?.label || '';

  return (
    <section>
      <h2>Projetos</h2>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <button className="item" title={project.path} onClick={() => onOpenProject(project)}>
              <strong>{folderName(project.path)}</strong>
              <small>{project.accountLabel}</small>
            </button>
            <button aria-label="Desvincular" onClick={() => onUnbind(project)}>
              Desvincular
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <select
          aria-label="Conta do projeto"
          value={selected}
          onChange={(e) => setAccountLabel(e.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.label}>
              {account.label}
            </option>
          ))}
        </select>
        <button disabled={!selected} onClick={() => onAddProject(selected)}>
          Adicionar projeto
        </button>
      </div>
    </section>
  );
}

function NewAccountForm({ onAddAccount }: Pick<SidebarProps, 'onAddAccount'>) {
  const [provider, setProvider] = useState<string>(PROVIDERS[0]);
  const [label, setLabel] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAddAccount({ provider, label: label.trim() });
    setLabel('');
  };

  return (
    <form className="row" onSubmit={submit}>
      <select aria-label="Provedor" value={provider} onChange={(e) => setProvider(e.target.value)}>
        {PROVIDERS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <input
        aria-label="Rótulo"
        placeholder="Rótulo"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button type="submit" disabled={!label.trim()}>
        Nova conta
      </button>
    </form>
  );
}

function AccountsSection(props: SidebarProps) {
  const { accounts, onLogin, onRemove, onAddAccount } = props;
  return (
    <section>
      <h2>Contas</h2>
      <ul>
        {accounts.map((account) => (
          <li key={account.id}>
            <div className="item">
              <strong>{account.label}</strong>
              <small>
                {account.provider} · {STATUS_TEXT[account.status]}
              </small>
            </div>
            <button onClick={() => onLogin(account)}>Entrar</button>
            <button onClick={() => onRemove(account)}>Remover</button>
          </li>
        ))}
      </ul>
      <NewAccountForm onAddAccount={onAddAccount} />
    </section>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      <ProjectsSection {...props} />
      <AccountsSection {...props} />
    </aside>
  );
}
