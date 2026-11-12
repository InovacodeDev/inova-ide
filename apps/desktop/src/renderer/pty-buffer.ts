export type Writer = (data: string) => void;

export interface PtyRouter {
  data: (sessionId: string, chunk: string) => void;
  exit: (sessionId: string) => void;
  attach: (sessionId: string, write: Writer) => () => void;
  consumeExit: (sessionId: string) => boolean;
  close: (sessionId: string) => void;
}

export function createPtyRouter(): PtyRouter {
  const buffers = new Map<string, string[]>();
  const writers = new Map<string, Writer>();
  const exited = new Set<string>();

  const release = (sessionId: string) => {
    buffers.delete(sessionId);
    writers.delete(sessionId);
  };

  return {
    data(sessionId, chunk) {
      const writer = writers.get(sessionId);
      if (writer) {
        writer(chunk);
        return;
      }
      const pending = buffers.get(sessionId);
      if (pending) pending.push(chunk);
      else buffers.set(sessionId, [chunk]);
    },
    exit(sessionId) {
      exited.add(sessionId);
    },
    attach(sessionId, write) {
      for (const chunk of buffers.get(sessionId) ?? []) write(chunk);
      buffers.delete(sessionId);
      writers.set(sessionId, write);
      return () => release(sessionId);
    },
    consumeExit(sessionId) {
      return exited.delete(sessionId);
    },
    close(sessionId) {
      release(sessionId);
      exited.delete(sessionId);
    },
  };
}
