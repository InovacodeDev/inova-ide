import { useEffect, useRef, useState } from 'react';
import type { VerificationCheck } from '@inova/core/types';
import type { ProjectView } from '../shared/api';
import { CloseIcon, SettingsIcon } from './icons';
import { useI18n } from './I18nContext';
import { openModalCount } from './modal-layers';
import { folderName } from './path-name';
import { addCustomCheck, removeCheck, toggleCheck } from './project-checks';
import { SettingGroup, SettingRow, Switch } from './settings-controls';
import { useDialogFocus } from './useDialogFocus';
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
  const { t } = useI18n();
  const [newCommand, setNewCommand] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const checks = project.verificationChecks ?? [];

  useDialogFocus(cardRef);

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
              {t('projectSettings.title')}
            </h2>
            <span className="modal-subtitle" title={project.path}>
              {folderName(project.path)}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('projectSettings.close')}
            data-tooltip={t('projectSettings.close')}
            data-shortcut="dismiss"
            onClick={props.onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="settings-panel project-settings-body">
          <SettingGroup title={t('projectSettings.automationTitle')}>
            <SettingRow
              htmlFor="project-auto-worktree"
              title={t('projectSettings.autoWorktreeTitle')}
              description={t('projectSettings.autoWorktreeDesc')}
            >
              <Switch
                id="project-auto-worktree"
                checked={project.autoWorktree ?? false}
                onChange={(checked) => onUpdate({ autoWorktree: checked })}
              />
            </SettingRow>
            <SettingRow
              htmlFor="project-auto-verify"
              title={t('projectSettings.autoVerifyTitle')}
              description={t('projectSettings.autoVerifyDesc')}
            >
              <Switch
                id="project-auto-verify"
                checked={project.autoVerify ?? false}
                onChange={(checked) => onUpdate({ autoVerify: checked })}
              />
            </SettingRow>
          </SettingGroup>
          <SettingGroup title={t('projectSettings.checksTitle')}>
            <div className="project-settings-actions">
              <button type="button" className="btn btn-sm" onClick={onDetectChecks}>
                {t('projectSettings.detectChecks')}
              </button>
              {canRunVerification ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={running || !checks.some((check) => check.enabled)}
                  onClick={onRunVerification}
                >
                  {t('projectSettings.runVerification')}
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
                      aria-label={t('projectSettings.removeCheckAria', { label: check.label })}
                      data-tooltip={t('projectSettings.removeCheckTooltip')}
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
              <p className="setting-group-desc">{t('projectSettings.noChecks')}</p>
            )}
            <div className="project-settings-add">
              <input
                type="text"
                className="field"
                value={newCommand}
                placeholder={t('projectSettings.newCheckPlaceholder')}
                aria-label={t('projectSettings.newCheckAria')}
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
                {t('projectSettings.add')}
              </button>
            </div>
          </SettingGroup>
        </div>
      </div>
    </div>
  );
}
