import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PtyRouter } from './pty-buffer';

export interface TerminalSize {
  cols: number;
  rows: number;
}

interface TerminalViewProps {
  sessionId: string;
  visible: boolean;
  exited: boolean;
  attach: PtyRouter['attach'];
  onSize: (size: TerminalSize) => void;
}

export function TerminalView({ sessionId, visible, exited, attach, onSize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSizeRef = useRef(onSize);
  const visibleRef = useRef(visible);
  const termRef = useRef<Terminal | null>(null);

  // NOTE: layout effect so the refs are current before ResizeObserver callbacks run on a display toggle.
  useLayoutEffect(() => {
    onSizeRef.current = onSize;
    visibleRef.current = visible;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#11111b' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    const dataSub = term.onData((data) => window.inova.ptyWrite(sessionId, data));
    const detach = attach(sessionId, (data) => term.write(data));
    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      fit.fit();
      const size = { cols: term.cols, rows: term.rows };
      window.inova.ptyResize({ sessionId, ...size });
      onSizeRef.current(size);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      detach();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, attach]);

  useEffect(() => {
    if (visible) termRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (exited) termRef.current?.write('\r\n[processo encerrado]\r\n');
  }, [exited]);

  return (
    <div
      ref={containerRef}
      className="terminal-host"
      style={{ display: visible ? 'block' : 'none' }}
    />
  );
}
