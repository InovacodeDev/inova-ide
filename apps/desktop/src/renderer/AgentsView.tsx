import { useState } from 'react';
import type { ProviderId } from '@inova/core/types';
import { PlusIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME } from './provider-meta';
import { STATUS_LABEL, type SessionStatus } from './session-status';
import './views.css';

export interface AgentCardData {
  sessionId: string;
  title: string;
  provider: ProviderId | null;
  where: string;
  status: SessionStatus;
  tail: string;
}

export interface AgentsViewProps {
  agents: AgentCardData[];
  onOpen: (sessionId: string) => void;
  onNewSession: () => void;
}

type Filter = 'all' | SessionStatus;

const STATUS_FILTERS: { id: SessionStatus; label: string }[] = [
  { id: 'running', label: 'Executando' },
  { id: 'done', label: 'Concluídos' },
  { id: 'error', label: 'Erro' },
  { id: 'idle', label: 'Ociosos' },
];

export function AgentsView(props: AgentsViewProps) {
  const { agents, onOpen, onNewSession } = props;
  const [filter, setFilter] = useState<Filter>('all');

  if (agents.length === 0) {
    return (
      <div className="view-scroll">
        <div className="agents-view">
          <div className="agents-empty">
            <p>Nenhuma sessão aberta.</p>
            <button type="button" className="btn btn-primary" onClick={onNewSession}>
              Nova sessão
            </button>
          </div>
        </div>
      </div>
    );
  }

  const countOf = (status: SessionStatus) => agents.filter((a) => a.status === status).length;
  const filters = [
    { id: 'all' as const, label: 'Todos', count: agents.length },
    ...STATUS_FILTERS.map((f) => ({ ...f, count: countOf(f.id) })).filter((f) => f.count > 0),
  ];
  const visible = filter === 'all' ? agents : agents.filter((a) => a.status === filter);

  return (
    <div className="view-scroll">
      <div className="agents-view">
        <header className="agents-header">
          <div className="agents-heading">
            <h1 className="agents-title">Agentes em paralelo</h1>
            <p className="agents-subtitle">
              Cada card é uma sessão aberta. Abra uma para conversar.
            </p>
          </div>
          <button type="button" className="btn" onClick={onNewSession}>
            <PlusIcon size={14} />
            Iniciar agente
          </button>
        </header>
        <div className="agents-filters" role="group" aria-label="Filtrar por status">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className="agents-filter"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} · {f.count}
            </button>
          ))}
        </div>
        <div className="agents-grid">
          {visible.map((agent) => (
            <article
              key={agent.sessionId}
              className={`agent-card${agent.status === 'error' ? ' agent-card-error' : ''}`}
            >
              <div className="agent-top">
                <ProviderBadge provider={agent.provider} size={24} />
                <div className="agent-heading">
                  <h2 className="agent-title">{agent.title}</h2>
                  <span className="agent-where mono">{agent.where}</span>
                </div>
                <span className={`pill pill-${agent.status}`}>
                  <span className={`dot${agent.status === 'running' ? ' pulse' : ''}`} />
                  {STATUS_LABEL[agent.status]}
                </span>
              </div>
              <div className="agent-tail mono">
                {agent.tail === '' ? (
                  <span className="agent-tail-empty">sem atividade</span>
                ) : (
                  agent.tail
                )}
              </div>
              <div className="agent-footer">
                <span>{agent.provider ? PROVIDER_NAME[agent.provider] : '—'}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onOpen(agent.sessionId)}
                >
                  Abrir
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
