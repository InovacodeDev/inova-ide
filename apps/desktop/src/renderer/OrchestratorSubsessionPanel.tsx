import { useEffect, useRef, useState } from 'react';
import type { ChatItem } from './chat-reducer';
import { useI18n } from './I18nContext';
import { Markdown } from './Markdown';
import type { OrchestratorSubsession } from './orchestrator-subsession';
import { ToolCard } from './ToolCard';

const NEAR_BOTTOM_PX = 40;

interface PanelProps {
  subsession: OrchestratorSubsession;
  onStop: () => void;
  onAdvance: () => void;
  onCopyText: (text: string) => void;
  onOpenFile?: (path: string) => void;
}

function SubsessionItem({
  item,
  onCopyText,
  onOpenFile,
}: {
  item: ChatItem;
  onCopyText: (text: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const { t } = useI18n();
  if (item.type === 'assistant') {
    return (
      <div className="chat-subsession-text">
        <Markdown text={item.text} streaming={item.streaming} onOpenFile={onOpenFile} />
      </div>
    );
  }
  if (item.type === 'thinking') {
    return (
      <details className="chat-subsession-thinking" open={item.streaming}>
        <summary>{t('chat.thinking')}</summary>
        <Markdown text={item.text} streaming={item.streaming} onOpenFile={onOpenFile} />
      </details>
    );
  }
  if (item.type === 'tool') {
    return <ToolCard item={item} onCopyText={onCopyText} onOpenFile={onOpenFile} />;
  }
  return null;
}

export function OrchestratorSubsessionPanel({
  subsession,
  onStop,
  onAdvance,
  onCopyText,
  onOpenFile,
}: PanelProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const phaseLabel =
    subsession.phase === 'planning'
      ? t('chat.subsession.phasePlanning')
      : subsession.phase === 'developing'
        ? t('chat.subsession.phaseDeveloping')
        : t('chat.subsession.phaseReviewing');

  useEffect(() => {
    const body = bodyRef.current;
    if (body && stickRef.current) body.scrollTop = body.scrollHeight;
  }, [subsession.items, collapsed]);

  return (
    <div className="chat-subsession" role="region" aria-label={t('chat.subsession.aria')}>
      <div className="chat-subsession-head">
        <button
          type="button"
          className="chat-subsession-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="dot pulse" aria-hidden="true" />
          <span className="chat-subsession-title">
            {t('chat.subsession.title', {
              phase: phaseLabel,
              model: subsession.agentLabel,
              round: subsession.round,
              max: subsession.maxRounds,
            })}
          </span>
          <span className="chat-subsession-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
        <div className="chat-subsession-actions">
          {subsession.phase === 'developing' ? (
            <button
              type="button"
              className="btn btn-sm"
              data-tooltip={t('chat.subsession.advanceTooltip')}
              onClick={onAdvance}
            >
              {t('chat.subsession.advance')}
            </button>
          ) : null}
          <button type="button" className="btn btn-sm btn-danger" onClick={onStop}>
            {t('chat.subsession.stop')}
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <div
          className="chat-subsession-body"
          ref={bodyRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
          }}
        >
          {subsession.items.length === 0 ? (
            <p className="chat-subsession-empty">{t('chat.subsession.empty')}</p>
          ) : (
            subsession.items.map((item) => (
              <SubsessionItem
                key={item.id}
                item={item}
                onCopyText={onCopyText}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
