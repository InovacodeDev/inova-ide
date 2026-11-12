import type { TabsState } from './tabs';

interface TabBarProps {
  state: TabsState;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export function TabBar({ state, onActivate, onClose }: TabBarProps) {
  return (
    <div className="tabbar">
      {state.tabs.map((tab) => (
        <div key={tab.sessionId} className={tab.sessionId === state.active ? 'tab active' : 'tab'}>
          <button onClick={() => onActivate(tab.sessionId)}>
            {tab.exited ? `${tab.title} (encerrado)` : tab.title}
          </button>
          <button aria-label="Fechar aba" onClick={() => onClose(tab.sessionId)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
