import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { FilePreview, SpreadsheetSheet } from '../shared/api';
import { copyToClipboard } from './clipboard';
import {
  clampZoom,
  filterSheetRows,
  findTextMatches,
  formatFileSize,
  spreadsheetColumnLabel,
} from './file-viewer-format';
import { clampViewerWidth, type FileViewerTab } from './file-viewer-state';
import { useI18n } from './I18nContext';
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FolderOpenIcon,
  GlobeIcon,
  MaximizeIcon,
  MinimizeIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TextWrapIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ZoomResetIcon,
} from './icons';
import { Markdown } from './Markdown';
import { highlightCode, languageForFilePath } from './shiki-highlight';
import './file-viewer.css';

export interface FileViewerPaneProps {
  readonly open: boolean;
  readonly maximized: boolean;
  readonly widthPx: number;
  readonly tabs: readonly FileViewerTab[];
  readonly activePath: string | null;
  readonly preview?: FilePreview | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onSelectTab: (path: string) => void;
  readonly onCloseTab: (path: string) => void;
  readonly onClosePanel: () => void;
  readonly onToggleMaximized: () => void;
  readonly onResizeWidth: (width: number) => void;
  readonly onPickFiles: () => void;
  readonly onOpenDroppedFiles: (paths: string[]) => void;
  readonly onReload: () => void;
  readonly onOpenExternal: (path: string) => void;
  readonly onOpenFile?: (path: string) => void;
}

interface CodeViewerProps {
  readonly code: string;
  readonly lang?: string;
  readonly filePath: string;
  readonly targetLine?: number | null;
  readonly sizeBytes?: number;
}

function CodeViewer({ code, lang, filePath, targetLine, sizeBytes }: CodeViewerProps) {
  const { t, locale } = useI18n();
  const [wordWrap, setWordWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const lines = useMemo(() => code.split(/\r?\n/), [code]);
  const effectiveLang = useMemo(() => lang || languageForFilePath(filePath), [lang, filePath]);

  const matches = useMemo(
    () => findTextMatches({ text: code, query: searchQuery }),
    [code, searchQuery],
  );

  useEffect(() => {
    let active = true;
    highlightCode({ code, lang: effectiveLang })
      .then((html) => {
        if (!active) return;
        queueMicrotask(() => {
          if (active) setHighlightedHtml(html);
        });
      })
      .catch(() => {
        if (!active) return;
        queueMicrotask(() => {
          if (active) setHighlightedHtml(null);
        });
      });
    return () => {
      active = false;
    };
  }, [code, effectiveLang]);

  useEffect(() => {
    if (searchOpen) {
      queueMicrotask(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }
  }, [searchOpen]);

  const handleNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIdx((idx) => (idx + 1) % matches.length);
  }, [matches]);

  const handlePrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIdx((idx) => (idx - 1 + matches.length) % matches.length);
  }, [matches]);

  useEffect(() => {
    if (matches.length === 0) return;
    const safeIdx = Math.min(currentMatchIdx, matches.length - 1);
    const lineIndex = matches[safeIdx];
    if (lineIndex === undefined) return;

    const container = containerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll('.line, .file-viewer-line');
    const targetElement = elements[lineIndex];
    if (targetElement) {
      targetElement.scrollIntoView({ block: 'center' });
      targetElement.classList.add('file-viewer-line-active');
      return () => {
        targetElement.classList.remove('file-viewer-line-active');
      };
    }
  }, [matches, currentMatchIdx, highlightedHtml]);

  useEffect(() => {
    if (!targetLine || targetLine <= 0) return;
    const lineIndex = targetLine - 1;
    const container = containerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll('.line, .file-viewer-line');
    const targetElement = elements[lineIndex];
    if (targetElement) {
      targetElement.scrollIntoView({ block: 'center' });
      targetElement.classList.add('file-viewer-line-target');
      return () => {
        targetElement.classList.remove('file-viewer-line-target');
      };
    }
  }, [targetLine, highlightedHtml]);

  const handleCopy = () => {
    void copyToClipboard({
      text: code,
      onError: () => {},
      locale,
    });
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setSearchOpen(true);
    } else if (e.key === 'Escape' && searchOpen) {
      e.preventDefault();
      setSearchOpen(false);
    }
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchOpen(false);
    }
  };

  return (
    <div className="file-viewer-body" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <span className="file-viewer-badge">{effectiveLang}</span>
          <span className="file-viewer-url-text">{filePath}</span>
        </div>
        <div className="file-viewer-toolbar-right">
          <button
            type="button"
            className={`file-viewer-btn-icon ${wordWrap ? 'file-viewer-btn-icon-active' : ''}`}
            onClick={() => setWordWrap((w) => !w)}
            title={t('fileViewer.toggleWrap')}
            aria-label={t('fileViewer.toggleWrap')}
          >
            <TextWrapIcon size={14} />
          </button>
          <button
            type="button"
            className={`file-viewer-btn-icon ${searchOpen ? 'file-viewer-btn-icon-active' : ''}`}
            onClick={() => setSearchOpen((s) => !s)}
            title={t('fileViewer.searchPlaceholder')}
            aria-label={t('fileViewer.searchPlaceholder')}
          >
            <SearchIcon size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handleCopy}
            title={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
            aria-label={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="file-viewer-search-bar">
          <div className="file-viewer-search-input-wrapper">
            <SearchIcon size={14} />
            <input
              ref={searchInputRef}
              type="search"
              className="file-viewer-search-input"
              placeholder={t('fileViewer.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentMatchIdx(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <span className="file-viewer-search-count">
              {searchQuery.trim().length === 0
                ? ''
                : matches.length > 0
                  ? t('fileViewer.searchMatches', {
                      current: currentMatchIdx + 1,
                      total: matches.length,
                    })
                  : t('fileViewer.searchNoMatches')}
            </span>
          </div>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handlePrevMatch}
            disabled={matches.length === 0}
            title={t('fileViewer.prevMatch')}
            aria-label={t('fileViewer.prevMatch')}
          >
            <ArrowUpIcon size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handleNextMatch}
            disabled={matches.length === 0}
            title={t('fileViewer.nextMatch')}
            aria-label={t('fileViewer.nextMatch')}
          >
            <ArrowDownIcon size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={() => setSearchOpen(false)}
            title={t('fileViewer.closeTab')}
            aria-label={t('fileViewer.closeTab')}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`file-viewer-code-wrapper ${wordWrap ? 'file-viewer-wrap' : ''}`}
      >
        {highlightedHtml !== null ? (
          <div
            className="file-viewer-shiki-container"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <div className="file-viewer-fallback-code">
            {lines.map((lineText, idx) => (
              <div key={idx} className="file-viewer-line">
                <span className="file-viewer-line-num">{idx + 1}</span>
                <span className="file-viewer-line-text">{lineText || ' '}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="file-viewer-footer">
        <span>{t('fileViewer.linesCount', { count: lines.length })}</span>
        <span>
          {t('fileViewer.bytesCount', {
            size: formatFileSize(sizeBytes ?? code.length),
          })}
        </span>
      </div>
    </div>
  );
}

function HtmlBrowserViewer({
  preview,
  onOpenExternal,
}: {
  readonly preview: Extract<FilePreview, { kind: 'html' }>;
  readonly onOpenExternal: (path: string) => void;
}) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [iframeKey, setIframeKey] = useState(0);

  const handleReload = () => {
    setIframeKey((k) => k + 1);
  };

  return (
    <div className="file-viewer-body">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <GlobeIcon size={14} />
          <span className="file-viewer-url-text">{preview.previewUrl ?? preview.resolvedPath}</span>
        </div>
        <div className="file-viewer-toolbar-right">
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handleReload}
            title={t('fileViewer.reload')}
            aria-label={t('fileViewer.reload')}
          >
            <RefreshIcon size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-btn-secondary"
            onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
            title={
              viewMode === 'preview' ? t('fileViewer.toggleSource') : t('fileViewer.togglePreview')
            }
          >
            {viewMode === 'preview' ? <FileCodeIcon size={14} /> : <GlobeIcon size={14} />}
            <span>
              {viewMode === 'preview'
                ? t('fileViewer.toggleSource')
                : t('fileViewer.togglePreview')}
            </span>
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={() => onOpenExternal(preview.resolvedPath)}
            title={t('fileViewer.openBrowser')}
            aria-label={t('fileViewer.openBrowser')}
          >
            <ExternalLinkIcon size={14} />
          </button>
        </div>
      </div>

      {viewMode === 'preview' ? (
        <iframe
          key={iframeKey}
          sandbox="allow-scripts allow-forms allow-popups"
          src={preview.previewUrl}
          title={preview.name}
          className="file-viewer-iframe"
        />
      ) : (
        <CodeViewer
          code={preview.content}
          lang="html"
          filePath={preview.resolvedPath}
          sizeBytes={preview.sizeBytes}
        />
      )}
    </div>
  );
}

function MarkdownFileViewer({
  preview,
  onOpenFile,
}: {
  readonly preview: Extract<FilePreview, { kind: 'markdown' }>;
  readonly onOpenFile?: (path: string) => void;
}) {
  const { t, locale } = useI18n();
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void copyToClipboard({
      text: preview.content,
      onError: () => {},
      locale,
    });
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="file-viewer-body">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <span className="file-viewer-badge">markdown</span>
          <span className="file-viewer-url-text">{preview.resolvedPath}</span>
        </div>
        <div className="file-viewer-toolbar-right">
          <button
            type="button"
            className="file-viewer-btn-secondary"
            onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
            title={
              viewMode === 'preview' ? t('fileViewer.toggleSource') : t('fileViewer.togglePreview')
            }
          >
            {viewMode === 'preview' ? <FileCodeIcon size={14} /> : <EyeIcon size={14} />}
            <span>
              {viewMode === 'preview'
                ? t('fileViewer.toggleSource')
                : t('fileViewer.togglePreview')}
            </span>
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handleCopy}
            title={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
            aria-label={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
      </div>

      {viewMode === 'preview' ? (
        <div className="file-viewer-markdown markdown-body">
          <Markdown text={preview.content} onOpenFile={onOpenFile} />
        </div>
      ) : (
        <CodeViewer
          code={preview.content}
          lang="markdown"
          filePath={preview.resolvedPath}
          sizeBytes={preview.sizeBytes}
        />
      )}
    </div>
  );
}

function SpreadsheetViewer({
  preview,
}: {
  readonly preview: Extract<FilePreview, { kind: 'spreadsheet' }>;
}) {
  const { t, locale } = useI18n();
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const sheets = preview.sheets;
  const currentSheet: SpreadsheetSheet | undefined = sheets[activeSheetIndex] ?? sheets[0];

  const filteredRows = useMemo(() => {
    if (!currentSheet) return [];
    return filterSheetRows({
      rows: currentSheet.rows,
      query: filterQuery,
    });
  }, [currentSheet, filterQuery]);

  const handleCopyCsv = () => {
    if (!currentSheet) return;
    const headerRow = currentSheet.columns.join(',');
    const bodyRows = currentSheet.rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
              return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
          })
          .join(','),
      )
      .join('\n');
    const csvContent = `${headerRow}\n${bodyRows}`;
    void copyToClipboard({
      text: csvContent,
      onError: () => {},
      locale,
    });
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  if (!currentSheet) {
    return (
      <div className="file-viewer-status-state">
        <AlertIcon size={24} />
        <span>{t('fileViewer.emptyTitle')}</span>
      </div>
    );
  }

  const columns =
    currentSheet.columns.length > 0
      ? currentSheet.columns
      : (currentSheet.rows[0]?.map((_, idx) => spreadsheetColumnLabel(idx)) ?? []);

  return (
    <div className="file-viewer-body">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <FileSpreadsheetIcon size={14} />
          {sheets.length > 1 && (
            <div className="file-viewer-sheet-tabs">
              {sheets.map((sheet, idx) => (
                <button
                  key={sheet.name}
                  type="button"
                  className={`file-viewer-sheet-tab-btn ${
                    idx === activeSheetIndex ? 'file-viewer-sheet-tab-btn-active' : ''
                  }`}
                  onClick={() => {
                    setActiveSheetIndex(idx);
                    setFilterQuery('');
                  }}
                >
                  {sheet.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="file-viewer-toolbar-right">
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={handleCopyCsv}
            title={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
            aria-label={copied ? t('fileViewer.copied') : t('fileViewer.copyContent')}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        </div>
      </div>

      <div className="file-viewer-search-bar">
        <div className="file-viewer-search-input-wrapper">
          <SearchIcon size={14} />
          <input
            type="search"
            className="file-viewer-search-input"
            placeholder={t('fileViewer.sheetFilterPlaceholder')}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>
      </div>

      {currentSheet.truncated && (
        <div className="file-viewer-sheet-truncated">
          <AlertIcon size={14} />
          <span>
            {t('fileViewer.sheetTruncated', {
              count: currentSheet.rows.length,
            })}
          </span>
        </div>
      )}

      <div className="file-viewer-table-wrapper">
        <table className="file-viewer-table">
          <thead>
            <tr>
              <th className="file-viewer-row-num">#</th>
              {columns.map((col, idx) => (
                <th key={idx}>{col || spreadsheetColumnLabel(idx)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.rowIndex}>
                <td className="file-viewer-row-num">{row.rowIndex}</td>
                {row.cells.map((cell, cIdx) => (
                  <td key={cIdx} title={cell}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="file-viewer-footer">
        <span>
          {t('fileViewer.sheetRowsCount', {
            count: currentSheet.totalRows || currentSheet.rows.length,
          })}
        </span>
        <span>{formatFileSize(preview.sizeBytes)}</span>
      </div>
    </div>
  );
}

function ImageViewer({ preview }: { readonly preview: Extract<FilePreview, { kind: 'image' }> }) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');

  const isSvg =
    preview.extension === '.svg' ||
    preview.extension === 'svg' ||
    Boolean(preview.content && preview.content.includes('<svg'));

  return (
    <div className="file-viewer-body">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <span className="file-viewer-url-text">{preview.resolvedPath}</span>
        </div>
        <div className="file-viewer-toolbar-right">
          {isSvg && preview.content && (
            <button
              type="button"
              className="file-viewer-btn-secondary"
              onClick={() => setViewMode(viewMode === 'preview' ? 'source' : 'preview')}
              title={
                viewMode === 'preview'
                  ? t('fileViewer.toggleSource')
                  : t('fileViewer.togglePreview')
              }
            >
              {viewMode === 'preview' ? <FileCodeIcon size={14} /> : <EyeIcon size={14} />}
              <span>
                {viewMode === 'preview'
                  ? t('fileViewer.toggleSource')
                  : t('fileViewer.togglePreview')}
              </span>
            </button>
          )}
          {viewMode === 'preview' && (
            <>
              <button
                type="button"
                className="file-viewer-btn-icon"
                onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                title={t('fileViewer.zoomOut')}
                aria-label={t('fileViewer.zoomOut')}
              >
                <ZoomOutIcon size={14} />
              </button>
              <button
                type="button"
                className="file-viewer-btn-icon"
                onClick={() => setZoom(1)}
                title={t('fileViewer.zoomReset')}
                aria-label={t('fileViewer.zoomReset')}
              >
                <ZoomResetIcon size={14} />
              </button>
              <button
                type="button"
                className="file-viewer-btn-icon"
                onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                title={t('fileViewer.zoomIn')}
                aria-label={t('fileViewer.zoomIn')}
              >
                <ZoomInIcon size={14} />
              </button>
              <span className="file-viewer-badge">{Math.round(zoom * 100)}%</span>
            </>
          )}
        </div>
      </div>

      {viewMode === 'preview' ? (
        <div className="file-viewer-image-container">
          <img
            src={preview.previewUrl}
            alt={preview.name}
            className="file-viewer-image"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      ) : (
        <CodeViewer
          code={preview.content ?? ''}
          lang="xml"
          filePath={preview.resolvedPath}
          sizeBytes={preview.sizeBytes}
        />
      )}
    </div>
  );
}

function PdfViewer({
  preview,
  onOpenExternal,
}: {
  readonly preview: Extract<FilePreview, { kind: 'pdf' }>;
  readonly onOpenExternal: (path: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="file-viewer-body">
      <div className="file-viewer-toolbar">
        <div className="file-viewer-toolbar-left">
          <span className="file-viewer-url-text">{preview.resolvedPath}</span>
        </div>
        <div className="file-viewer-toolbar-right">
          <button
            type="button"
            className="file-viewer-btn-secondary"
            onClick={() => onOpenExternal(preview.resolvedPath)}
          >
            <ExternalLinkIcon size={14} />
            <span>{t('fileViewer.openExternal')}</span>
          </button>
        </div>
      </div>
      <iframe src={preview.previewUrl} title={preview.name} className="file-viewer-pdf-frame" />
    </div>
  );
}

function FallbackViewer({
  preview,
  onOpenExternal,
}: {
  readonly preview: Extract<FilePreview, { kind: 'binary' | 'too-large' }>;
  readonly onOpenExternal: (path: string) => void;
}) {
  const { t } = useI18n();

  const message =
    preview.kind === 'binary'
      ? t('fileViewer.binaryFile')
      : t('fileViewer.tooLargeFile', {
          size: formatFileSize(preview.sizeBytes),
        });

  return (
    <div className="file-viewer-body file-viewer-status-state">
      <div className="file-viewer-fallback-card">
        <span className="file-viewer-empty-icon">
          <FileIcon size={40} />
        </span>
        <h3 className="file-viewer-fallback-name">{preview.name}</h3>
        <p className="file-viewer-error-text">{message}</p>
        {preview.reason && <p className="file-viewer-fallback-reason">{preview.reason}</p>}
        <div className="file-viewer-fallback-meta">
          <span>{preview.resolvedPath}</span>
          <span>{formatFileSize(preview.sizeBytes)}</span>
        </div>
        <button
          type="button"
          className="file-viewer-open-btn"
          onClick={() => onOpenExternal(preview.resolvedPath)}
        >
          <ExternalLinkIcon size={16} />
          <span>{t('fileViewer.openExternal')}</span>
        </button>
      </div>
    </div>
  );
}

export function FileViewerPane({
  open,
  maximized,
  widthPx,
  tabs,
  activePath,
  preview,
  loading,
  error,
  onSelectTab,
  onCloseTab,
  onClosePanel,
  onToggleMaximized,
  onResizeWidth,
  onPickFiles,
  onOpenDroppedFiles,
  onReload,
  onOpenExternal,
  onOpenFile,
}: FileViewerPaneProps) {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.resolvedPath === activePath),
    [tabs, activePath],
  );

  const handleResizeMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthPx;

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const nextWidth = clampViewerWidth({
        width: startWidth + deltaX,
        containerWidth: window.innerWidth,
      });
      onResizeWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const paths: string[] = [];
    if (e.dataTransfer?.files) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file) {
          const resolved = window.inova?.getPathForFile
            ? window.inova.getPathForFile(file)
            : ((file as { path?: string }).path ?? '');
          if (resolved) {
            paths.push(resolved);
          }
        }
      }
    }
    if (paths.length > 0) {
      onOpenDroppedFiles(paths);
    }
  };

  const formatErrorMessage = (err: string): string => {
    if (err.includes('access-denied') || err.includes('fora da pasta do projeto')) {
      return t('fileViewer.accessDenied');
    }
    if (err.includes('not-found') || err.includes('ENOENT')) {
      return t('fileViewer.fileNotFound');
    }
    return t('fileViewer.loadError', { error: err });
  };

  if (!open) return null;

  return (
    <aside
      className={`file-viewer-pane ${maximized ? 'file-viewer-pane-maximized' : ''}`}
      style={maximized ? { width: '100%' } : { width: `${widthPx}px` }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!maximized && (
        <div
          className="file-viewer-resizer"
          onMouseDown={handleResizeMouseDown}
          aria-hidden="true"
        />
      )}

      {isDragging && (
        <div className="file-viewer-drop-overlay">
          <FolderOpenIcon size={32} />
          <span>{t('fileViewer.dropOverlay')}</span>
        </div>
      )}

      <div className="file-viewer-tab-bar" role="tablist" aria-label={t('fileViewer.title')}>
        <div className="file-viewer-tabs-scroll">
          {tabs.map((tab) => {
            const isActive = tab.resolvedPath === activePath;
            return (
              <div
                key={tab.resolvedPath}
                role="tab"
                aria-selected={isActive}
                className={`file-viewer-tab ${isActive ? 'file-viewer-tab-active' : ''}`}
                onClick={() => onSelectTab(tab.resolvedPath)}
                title={tab.resolvedPath}
              >
                <span className="file-viewer-tab-icon">
                  <FileIcon size={14} />
                </span>
                <span className="file-viewer-tab-title">{tab.title}</span>
                <button
                  type="button"
                  className="file-viewer-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.resolvedPath);
                  }}
                  title={t('fileViewer.closeTab')}
                  aria-label={t('fileViewer.closeTab')}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={onPickFiles}
            title={t('fileViewer.openFile')}
            aria-label={t('fileViewer.openFile')}
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <div className="file-viewer-header-actions">
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={onReload}
            title={t('fileViewer.reload')}
            aria-label={t('fileViewer.reload')}
          >
            <RefreshIcon size={14} />
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={onToggleMaximized}
            title={maximized ? t('fileViewer.restore') : t('fileViewer.maximize')}
            aria-label={maximized ? t('fileViewer.restore') : t('fileViewer.maximize')}
          >
            {maximized ? <MinimizeIcon size={14} /> : <MaximizeIcon size={14} />}
          </button>
          <button
            type="button"
            className="file-viewer-btn-icon"
            onClick={onClosePanel}
            title={t('fileViewer.closePanel')}
            aria-label={t('fileViewer.closePanel')}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </div>

      {tabs.length === 0 ? (
        <div className="file-viewer-empty">
          <span className="file-viewer-empty-icon">
            <FileIcon size={36} />
          </span>
          <h3 className="file-viewer-empty-title">{t('fileViewer.emptyTitle')}</h3>
          <p className="file-viewer-empty-desc">{t('fileViewer.emptyDesc')}</p>
          <button type="button" className="file-viewer-open-btn" onClick={onPickFiles}>
            <FolderOpenIcon size={16} />
            <span>{t('fileViewer.openFile')}</span>
          </button>
        </div>
      ) : loading ? (
        <div className="file-viewer-status-state">
          <span className="file-viewer-spin">
            <RefreshIcon size={20} />
          </span>
          <span>{t('fileViewer.loading')}</span>
        </div>
      ) : error ? (
        <div className="file-viewer-status-state file-viewer-error-state">
          <span className="file-viewer-error-icon">
            <AlertIcon size={24} />
          </span>
          <p className="file-viewer-error-text">{formatErrorMessage(error)}</p>
          <div className="file-viewer-status-actions">
            <button type="button" className="file-viewer-btn-secondary" onClick={onReload}>
              <RefreshIcon size={14} />
              <span>{t('fileViewer.reload')}</span>
            </button>
            {activePath && (
              <button
                type="button"
                className="file-viewer-btn-secondary"
                onClick={() => onCloseTab(activePath)}
              >
                <CloseIcon size={14} />
                <span>{t('fileViewer.closeTab')}</span>
              </button>
            )}
          </div>
        </div>
      ) : preview ? (
        (() => {
          switch (preview.kind) {
            case 'html':
              return (
                <HtmlBrowserViewer
                  key={preview.resolvedPath}
                  preview={preview}
                  onOpenExternal={onOpenExternal}
                />
              );
            case 'markdown':
              return (
                <MarkdownFileViewer
                  key={preview.resolvedPath}
                  preview={preview}
                  onOpenFile={onOpenFile}
                />
              );
            case 'text':
              return (
                <CodeViewer
                  key={preview.resolvedPath}
                  code={preview.content}
                  filePath={preview.resolvedPath}
                  targetLine={activeTab?.line}
                  sizeBytes={preview.sizeBytes}
                />
              );
            case 'spreadsheet':
              return <SpreadsheetViewer key={preview.resolvedPath} preview={preview} />;
            case 'image':
              return <ImageViewer key={preview.resolvedPath} preview={preview} />;
            case 'pdf':
              return (
                <PdfViewer
                  key={preview.resolvedPath}
                  preview={preview}
                  onOpenExternal={onOpenExternal}
                />
              );
            case 'binary':
            case 'too-large':
              return (
                <FallbackViewer
                  key={preview.resolvedPath}
                  preview={preview}
                  onOpenExternal={onOpenExternal}
                />
              );
          }
        })()
      ) : (
        <div className="file-viewer-status-state">
          <span>{t('fileViewer.emptyDesc')}</span>
        </div>
      )}
    </aside>
  );
}
