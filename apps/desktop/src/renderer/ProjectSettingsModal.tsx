import { useEffect, useRef, useState } from 'react';
import type { VerificationCheck } from '@inova/core/types';
import type { ProjectView } from '../shared/api';
import { CloseIcon, SettingsIcon } from './icons';
import { openModalCount } from './modal-layers';
import { folderName } from './path-name';
import { addCustomCheck, removeCheck, toggleCheck } from './project-checks';
import { SettingGroup, SettingRow, Switch } from './settings-controls';
import './modal.css';
import './settings.css';

export interface ProjectVerificationPatch {
  autoWorktree?: boolean;
  autoVerify?: boolean;
  verificationChecks?: VerificationCheck[];
}

interface ProjectSettingsModalProps {
  project: ProjectView;
  running: boolean;
  canRunVerification: boolean;
  onUpdate: (patch: ProjectVerificationPatch) => void;
  onDetectChecks: () => void;
  onRunVerification: () => void;
  onClose: () => void;
}

export function ProjectSettingsModal(props: ProjectSettingsModalProps) {
  const { project, running, canRunVerification, onUpdate, onDetectChecks, onRunVerification } =
    props;
  const [newCommand, setNewCommand] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const checks = project.verificationChecks ?? [];

  useEffect(() => {
    const previous = document.activeElement;
    cardRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || openModalCount() > 1) return;
      event.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const submitCustomCheck = () => {
    const next = addCustomCheck({
      checks,
      command: newCommand,
      id: `custom-${Date.now()}`,
    });
    if (next === checks) return;
    onUpdate({ verificationChecks: next });
    setNewCommand('');
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-settings-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div ref={cardRef} className="modal-card project-settings-card" tabIndex={-1}>
        <div className="modal-header">
          <SettingsIcon size={17} />
          <div className="modal-title-group">
            <h2 id="project-settings-title" className="modal-title">
              Configurações do projeto
            </h2>
            <span className="modal-subtitle" title={project.path}>
              {folderName(project.path)}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar configurações do projeto"
            data-tooltip="Fechar configurações do projeto"
            data-shortcut="dismiss"
            onClick={props.onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="settings-panel project-settings-body">
          <SettingGroup title="Automação">
            <SettingRow
              htmlFor="project-auto-worktree"
              title="Criar worktree para cada nova sessão"
              description="Isola cada sessão em uma worktree própria do repositório."
            >
              <Switch
                id="project-auto-worktree"
                checked={project.autoWorktree ?? false}
                onChange={(checked) => onUpdate({ autoWorktree: checked })}
              />
            </SettingRow>
            <SettingRow
              htmlFor="project-auto-verify"
              title="Verificar após cada turno"
              description="Executa os comandos de verificação ativos ao fim de cada turno."
            >
              <Switch
                id="project-auto-verify"
                checked={project.autoVerify ?? false}
                onChange={(checked) => onUpdate({ autoVerify: checked })}
              />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title="Comandos de verificação">
            <div className="project-settings-actions">
              <button type="button" className="btn btn-sm" onClick={onDetectChecks}>
                Detectar comandos
              </button>
              {canRunVerification ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={running || !checks.some((check) => check.enabled)}
                  onClick={onRunVerification}
                >
                  Executar verificação
                </button>
              ) : null}
            </div>
            {checks.length > 0 ? (
              <ul className="project-settings-checks">
                {checks.map((check) => (
                  <li key={check.id} className="project-settings-check-row">
                    <label className="project-settings-check" title={check.command}>
                      <input
                        type="checkbox"
                        checked={check.enabled}
                        onChange={() =>
                          onUpdate({ verificationChecks: toggleCheck({ checks, id: check.id }) })
                        }
                      />
                      <span className="mono">{check.label}</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Remover ${check.label}`}
                      data-tooltip="Remover comando de verificação"
                      onClick={() =>
                        onUpdate({ verificationChecks: removeCheck({ checks, id: check.id }) })
                      }
                    >
                      <CloseIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="setting-group-desc">Nenhum comando configurado.</p>
            )}
            <div className="project-settings-add">
              <input
                type="text"
                className="field"
                value={newCommand}
                placeholder="Comando (ex: pnpm test)"
                aria-label="Novo comando de verificação"
                onChange={(event) => setNewCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitCustomCheck();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={newCommand.trim() === ''}
                onClick={submitCustomCheck}
              >
                Adicionar
              </button>
            </div>
          </SettingGroup>
        </div>
      </div>
    </div>
  );
}
