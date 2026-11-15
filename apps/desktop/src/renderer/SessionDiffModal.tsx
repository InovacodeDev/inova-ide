import { useMemo, useRef, useState } from 'react';
import type { WorktreeStatusView } from '../shared/api';
import {
  parseUnifiedGitDiff,
  splitFilePath,
  STATUS_BADGE,
  STATUS_TITLE,
  summarizeGitChanges,
  type GitDiffLine,
} from './git-diff-presentation';
import { CloseIcon, GitBranchIcon, RefreshIcon, RotateCcwIcon, ShieldCheckIcon } from './icons';
import { useDialogFocus } from './useDialogFocus';

interface SessionDiffModalProps {
  status: WorktreeStatusView;
  hasWorktree: boolean;
  busy: boolean;
  initialFilePath?: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onApplyWorktree?: () => void;
  onReviewDiff?: () => void;
  onRevertFiles: (files: string[]) => Promise<boolean> | void;
}

function diffRowClass(type: GitDiffLine['type']): string {
  if (type === 'add') return 'chat-diff-line chat-diff-line-add';
  if (type === 'del') return 'chat-diff-line chat-diff-line-del';
  return 'chat-diff-line chat-diff-line-ctx';
}

function diffSign(type: GitDiffLine['type']): string {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

export function SessionDiffModal({
  status,
  hasWorktree,
  busy,
  initialFilePath = null,
  onClose,
  onRefresh,
  onApplyWorktree,
  onReviewDiff,
  onRevertFiles,
}: SessionDiffModalProps) {
  const files = useMemo(
    () => parseUnifiedGitDiff({ diff: status.diff, changedFiles: status.changedFiles }),
    [status.diff, status.changedFiles],
  );
  const summary = useMemo(() => summarizeGitChanges(files), [files]);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialFilePath);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const cardRef = useRef<HTMLDivElement>(null);

  useDialogFocus(cardRef);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worktree-diff-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={cardRef} tabIndex={-1} className="modal-card session-diff-modal-card">
        <div className="modal-header">
          <GitBranchIcon size={17} />
          <div className="modal-title-group">
            <h2 id="worktree-diff-title" className="modal-title">
              Alterações do worktree ({status.branch || 'HEAD'})
            </h2>
            {summary.fileCount > 0 ? (
              <div className="session-diff-header-meta mono">
                <span>
                  {summary.fileCount} {summary.fileCount === 1 ? 'arquivo' : 'arquivos'}
                </span>
                <span className="chat-diff-stat-add">+{summary.addedLines}</span>
                <span className="chat-diff-stat-del">-{summary.removedLines}</span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Atualizar diff"
            data-tooltip="Atualizar diff"
            onClick={onRefresh}
          >
            <RefreshIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fechar diff do worktree"
            data-tooltip="Fechar diff do worktree"
            data-shortcut="dismiss"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className={files.length === 0 ? 'modal-body' : 'modal-body session-diff-body'}>
          {files.length === 0 ? (
            <p className="modal-description">Nenhuma alteração pendente em relação à base.</p>
          ) : (
            <div className="session-diff-layout">
              <div className="session-diff-sidebar" role="list" aria-label="Arquivos alterados">
                {files.map((file) => {
                  const { fileName, dirName } = splitFilePath(file.path);
                  const active = selectedFile?.path === file.path;
                  return (
                    <div
                      key={file.path}
                      role="listitem"
                      className={
                        active ? 'session-diff-file-item active' : 'session-diff-file-item'
                      }
                    >
                      <button
                        type="button"
                        className="session-diff-file-select"
                        onClick={() => setSelectedPath(file.path)}
                        title={file.path}
                      >
                        <span className="session-git-badge" data-status={file.status}>
                          {STATUS_BADGE[file.status]}
                        </span>
                        <span className="session-diff-file-names">
                          <span className="session-diff-file-name mono">{fileName}</span>
                          {dirName ? (
                            <span className="session-diff-file-dir mono">{dirName}</span>
                          ) : null}
                        </span>
                        <span className="session-diff-file-stats mono">
                          {file.addedLines > 0 ? (
                            <span className="chat-diff-stat-add">+{file.addedLines}</span>
                          ) : null}
                          {file.removedLines > 0 ? (
                            <span className="chat-diff-stat-del">-{file.removedLines}</span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn session-diff-file-revert"
                        aria-label={`Reverter ${file.path}`}
                        data-tooltip="Reverter arquivo"
                        disabled={busy}
                        onClick={() => void onRevertFiles([file.path])}
                      >
                        <RotateCcwIcon size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {selectedFile ? (
                <div className="session-diff-main">
                  <div className="session-diff-file-header">
                    <div className="session-diff-file-title">
                      <span className="session-git-badge" data-status={selectedFile.status}>
                        {STATUS_TITLE[selectedFile.status]}
                      </span>
                      <span className="session-diff-file-path mono">{selectedFile.path}</span>
                      {selectedFile.oldPath ? (
                        <span className="session-diff-file-old mono">← {selectedFile.oldPath}</span>
                      ) : null}
                    </div>
                    <div className="session-diff-file-actions">
                      <span className="chat-diff-stat-add">+{selectedFile.addedLines}</span>
                      <span className="chat-diff-stat-del">-{selectedFile.removedLines}</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => void onRevertFiles([selectedFile.path])}
                      >
                        <RotateCcwIcon size={13} />
                        Reverter arquivo
                      </button>
                    </div>
                  </div>
                  <div className="session-diff-table-wrap">
                    {selectedFile.binary ? (
                      <p className="session-details-empty">
                        Arquivo binário alterado — visualização textual indisponível.
                      </p>
                    ) : selectedFile.lines.length === 0 ? (
                      <p className="session-details-empty">
                        Sem linhas de diff textual para exibir.
                      </p>
                    ) : (
                      <div className="chat-diff-view session-diff-view">
                        {selectedFile.lines.map((line, index) =>
                          line.type === 'hunk' ? (
                            <div key={index} className="session-diff-hunk-line mono">
                              {line.text}
                            </div>
                          ) : (
                            <div key={index} className={diffRowClass(line.type)}>
                              <span className="chat-diff-num">
                                {line.newLine ?? line.oldLine ?? ''}
                              </span>
                              <span className="chat-diff-sign">{diffSign(line.type)}</span>
                              <span className="chat-diff-code">
                                {line.text === '' ? ' ' : line.text}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Fechar
          </button>
          {files.length > 0 ? (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void onRevertFiles(files.map((file) => file.path))}
            >
              Reverter tudo
            </button>
          ) : null}
          {files.length > 0 && onReviewDiff ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={onReviewDiff}
            >
              <ShieldCheckIcon size={14} />
              Revisar diff
            </button>
          ) : null}
          {hasWorktree && files.length > 0 && onApplyWorktree ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={onApplyWorktree}
            >
              Aplicar no projeto principal
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
