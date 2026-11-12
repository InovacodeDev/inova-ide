import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { ProviderId } from '@inova/core/types';
import type { AccountView, OpenedSession, ProjectView } from '../shared/api';
import { createPtyRouter } from './pty-buffer';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { TerminalView, type TerminalSize } from './TerminalView';
import { tabsReducer } from './tabs';
import { useWarning } from './useWarning';

const DEFAULT_SIZE: TerminalSize = { cols: 120, rows: 32 };
const GEMINI_HINT = 'No Gemini, escolha "Sign in with Google" e saia com /quit.';

export function App() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const { warning, dismiss, guard, call } = useWarning();
  const [tabs, dispatch] = useReducer(tabsReducer, { tabs: [], active: null });
  const sizeRef = useRef<TerminalSize>(DEFAULT_SIZE);
  const loginSessions = useRef(new Map<string, ProviderId>());
  const [router] = useState(createPtyRouter);

  const reloadAccounts = useCallback(async () => {
    const result = await call(() => window.inova.listAccounts());
    if (result) setAccounts(result.value);
  }, [call]);

  const reloadProjects = useCallback(async () => {
    const result = await call(() => window.inova.listProjects());
    if (result) setProjects(result.value);
  }, [call]);

  useEffect(() => {
    void reloadAccounts();
    void reloadProjects();
  }, [reloadAccounts, reloadProjects]);

  useEffect(() => {
    const offData = window.inova.onPtyData(({ sessionId, data }) => router.data(sessionId, data));
    const offExit = window.inova.onPtyExit(({ sessionId }) => {
      router.exit(sessionId);
      dispatch({ type: 'exited', sessionId });
      if (loginSessions.current.has(sessionId)) void reloadAccounts();
    });
    return () => {
      offData();
      offExit();
    };
  }, [router, reloadAccounts]);

  const openTab = (session: OpenedSession, loginProvider?: ProviderId) => {
    if (loginProvider) loginSessions.current.set(session.sessionId, loginProvider);
    dispatch({ type: 'open', tab: session });
    if (router.consumeExit(session.sessionId)) {
      dispatch({ type: 'exited', sessionId: session.sessionId });
      if (loginProvider) void reloadAccounts();
    }
  };

  const closeTab = (sessionId: string) => {
    void guard(async () => window.inova.ptyClose(sessionId));
    router.close(sessionId);
    dispatch({ type: 'close', sessionId });
    if (loginSessions.current.delete(sessionId)) void reloadAccounts();
  };

  const addProject = async (accountLabel: string) => {
    const path = await guard(() => window.inova.pickFolder());
    if (!path) return;
    const result = await call(() => window.inova.bindProject({ path, accountLabel }));
    if (result) await reloadProjects();
  };

  const removeAccount = async (account: AccountView) => {
    const message = `Remover a conta ${account.label}? Os projetos vinculados a ela serão desvinculados.`;
    if (!confirm(message)) return;
    const result = await call(() =>
      window.inova.removeAccount({ label: account.label, force: true }),
    );
    if (result) await Promise.all([reloadAccounts(), reloadProjects()]);
  };

  const activeTab = tabs.tabs.find((tab) => tab.sessionId === tabs.active);
  const activeLogin = tabs.active ? loginSessions.current.get(tabs.active) : undefined;

  return (
    <div className="app">
      {warning && (
        <div className="warning" role="alert" onClick={dismiss}>
          {warning}
        </div>
      )}
      <Sidebar
        accounts={accounts}
        projects={projects}
        onOpenProject={async (project) => {
          const result = await call(() =>
            window.inova.openProject({ projectId: project.id, ...sizeRef.current }),
          );
          if (result) openTab(result.value);
        }}
        onAddProject={(label) => void addProject(label)}
        onUnbind={async (project) => {
          const result = await call(() => window.inova.unbindProject({ path: project.path }));
          if (result) await reloadProjects();
        }}
        onLogin={async (account) => {
          const result = await call(() =>
            window.inova.openLogin({ accountLabel: account.label, ...sizeRef.current }),
          );
          if (result) openTab(result.value, account.provider);
        }}
        onRemove={(account) => void removeAccount(account)}
        onAddAccount={async (input) => {
          const result = await call(() => window.inova.addAccount(input));
          if (result) await reloadAccounts();
        }}
      />
      <main className="main">
        <TabBar
          state={tabs}
          onActivate={(sessionId) => dispatch({ type: 'activate', sessionId })}
          onClose={closeTab}
        />
        {activeLogin === 'gemini' && !activeTab?.exited && <p className="hint">{GEMINI_HINT}</p>}
        <div className="terminals">
          {tabs.tabs.map((tab) => (
            <TerminalView
              key={tab.sessionId}
              sessionId={tab.sessionId}
              visible={tab.sessionId === tabs.active}
              exited={tab.exited}
              attach={router.attach}
              onSize={(size) => {
                sizeRef.current = size;
              }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
