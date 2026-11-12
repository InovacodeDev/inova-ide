import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

export interface TerminalSize {
  cols: number;
  rows: number;
}

interface TerminalViewProps {
  sessionId: string;
  visible: boolean;
  onSize: (size: TerminalSize) => void;
}

export function TerminalView({ sessionId, visible, onSize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const termRef = useRef<Terminal | null>(null);

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
    const offData = window.inova.onPtyData((event) => {
      if (event.sessionId === sessionId) term.write(event.data);
    });
    const offExit = window.inova.onPtyExit((event) => {
      if (event.sessionId === sessionId) term.write('\r\n[processo encerrado]\r\n');
    });
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
      offData();
      offExit();
      dataSub.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (visible) termRef.current?.focus();
  }, [visible]);

  return (
    <div ref={containerRef} className="terminal" style={{ display: visible ? 'block' : 'none' }} />
  );
}
