import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProviderId } from '@inova/core/types';
import type { LoginStage } from '../shared/api';
import { AlertIcon, CheckIcon, CloseIcon, CopyIcon, ExternalLinkIcon } from './icons';
import { useI18n } from './I18nContext';
import { ProviderBadge } from './ProviderBadge';
import { PROVIDER_NAME, accountDisplayName } from './provider-meta';
import { useDialogFocus } from './useDialogFocus';
import './modal.css';

export interface LoginModalState {
  sessionId: string | null;
  provider: ProviderId;
  accountLabel: string;
  accountEmail: string | null;
  stage: LoginStage;
  authUrl: string | null;
  codePrompt: boolean;
  message: string | null;
}

interface LoginModalProps {
  state: LoginModalState;
  onCancel: (sessionId: string) => void;
  onClose: () => void;
  onRetry: () => void;
  onSubmitCode: (input: { sessionId: string; code: string }) => Promise<boolean>;
}

type TranslateFn = ReturnType<typeof useI18n>['t'];

function stageCopy(stage: LoginStage, t: TranslateFn): { title: string; description: string } {
  switch (stage) {
    case 'starting':
      return {
        title: t('login.stage.starting.title'),
        description: t('login.stage.starting.desc'),
      };
    case 'waiting-auth':
      return {
        title: t('login.stage.waitingAuth.title'),
        description: t('login.stage.waitingAuth.desc'),
      };
    case 'verifying':
      return {
        title: t('login.stage.verifying.title'),
        description: t('login.stage.verifying.desc'),
      };
    case 'succeeded':
      return {
        title: t('login.stage.succeeded.title'),
        description: t('login.stage.succeeded.desc'),
      };
    case 'failed':
      return { title: t('login.stage.failed.title'), description: t('login.stage.failed.desc') };
    case 'canceled':
      return {
        title: t('login.stage.canceled.title'),
        description: t('login.stage.canceled.desc'),
      };
  }
}

function stepIndexOf(stage: LoginStage): number {
  switch (stage) {
    case 'starting':
      return 0;
    case 'waiting-auth':
      return 1;
    case 'verifying':
      return 2;
    case 'succeeded':
      return 3;
    case 'failed':
    case 'canceled':
      return -1;
  }
}

export function LoginModal({ state, onCancel, onClose, onRetry, onSubmitCode }: LoginModalProps) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [submittingCode, setSubmittingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useDialogFocus(cardRef);

  const inProgress =
    state.stage === 'starting' || state.stage === 'waiting-auth' || state.stage === 'verifying';
  const copy = stageCopy(state.stage, t);
  const stepIndex = stepIndexOf(state.stage);
  const steps = [t('login.step.prepare'), t('login.step.authorize'), t('login.step.validate')];

  const handleDismiss = () => {
    if (inProgress && state.sessionId !== null) onCancel(state.sessionId);
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (inProgress && state.sessionId !== null) onCancel(state.sessionId);
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inProgress, state.sessionId, onCancel, onClose]);

  const handleCopy = async () => {
    if (state.authUrl === null) return;
    try {
      await navigator.clipboard.writeText(state.authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleCodeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.sessionId === null || code.trim() === '' || submittingCode) return;
    setSubmittingCode(true);
    try {
      if (await onSubmitCode({ sessionId: state.sessionId, code: code.trim() })) {
        setCode('');
      }
    } finally {
      setSubmittingCode(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !inProgress) onClose();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card">
        <div className="modal-header">
          <ProviderBadge provider={state.provider} size={28} />
          <div className="modal-title-group">
            <h2 id="login-modal-title" className="modal-title">
              {t('login.title', { provider: PROVIDER_NAME[state.provider] })}
            </h2>
            <span className="modal-subtitle">
              {t('login.accountSubtitle', {
                label: accountDisplayName({
                  label: state.accountLabel,
                  email: state.accountEmail,
                }),
              })}
            </span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('login.close')}
            data-tooltip={t('login.close')}
            data-shortcut="dismiss"
            onClick={handleDismiss}
          >
            <CloseIcon size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="login-hero">
            {inProgress && (
              <div className="login-spinner" aria-hidden="true">
                <span className="login-spinner-track" />
                <span className="login-spinner-arc" />
              </div>
            )}
            {state.stage === 'succeeded' && (
              <div className="login-hero-ok" aria-hidden="true">
                <CheckIcon size={18} />
              </div>
            )}
            {(state.stage === 'failed' || state.stage === 'canceled') && (
              <div className="login-hero-bad" aria-hidden="true">
                <AlertIcon size={18} />
              </div>
            )}
            <div className="login-hero-text">
              <span className="login-hero-title">{copy.title}</span>
              <span className="login-hero-desc">{state.message ?? copy.description}</span>
            </div>
          </div>

          {stepIndex >= 0 && (
            <ol className="login-steps">
              {steps.map((label, index) => {
                const done = stepIndex > index;
                const active = stepIndex === index;
                const className = done
                  ? 'login-step login-step-done'
                  : active
                    ? 'login-step login-step-active'
                    : 'login-step';
                return (
                  <li key={label} className={className}>
                    <span className="login-step-dot">
                      {done ? <CheckIcon size={11} /> : index + 1}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {inProgress && state.authUrl !== null && (
            <div className="login-url-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  if (state.authUrl !== null) {
                    window.open(state.authUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <ExternalLinkIcon size={13} />
                {t('login.openBrowser')}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void handleCopy()}>
                <CopyIcon size={13} />
                {copied ? t('login.copiedLink') : t('login.copyLink')}
              </button>
            </div>
          )}

          {inProgress && state.codePrompt && state.sessionId !== null && (
            <form className="login-code-form" onSubmit={(event) => void handleCodeSubmit(event)}>
              <label htmlFor="login-auth-code" className="login-code-label">
                {t('login.codePromptLabel')}
              </label>
              <div className="login-code-row">
                <input
                  id="login-auth-code"
                  type="text"
                  className="field login-code-input"
                  value={code}
                  placeholder={t('login.codePlaceholder')}
                  disabled={submittingCode}
                  onChange={(event) => setCode(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={code.trim() === '' || submittingCode}
                >
                  {t('login.confirm')}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="modal-footer">
          {inProgress && (
            <button type="button" className="btn" onClick={handleDismiss}>
              {t('common.cancel')}
            </button>
          )}
          {state.stage === 'succeeded' && (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('login.done')}
            </button>
          )}
          {(state.stage === 'failed' || state.stage === 'canceled') && (
            <>
              <button type="button" className="btn" onClick={onClose}>
                {t('common.close')}
              </button>
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                {t('login.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
