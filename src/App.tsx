import { useState } from 'react';
import GameView from './components/GameView';
import SettingsView from './components/SettingsView';
import TasksView from './components/TasksView';
import { BONUS_PER_DAY, completionsOn } from './economy/rewards';
import { useApp } from './useApp';
import { localDate } from './util';

type Tab = 'tasks' | 'game' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'tasks', label: '📝 記事本' },
  { id: 'game', label: '🧱 消消樂' },
  { id: 'settings', label: '⚙️ 設定' },
];

export default function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('tasks');
  const { game, activity } = app.data;
  const bonusUsed = Math.min(BONUS_PER_DAY, completionsOn(activity, localDate(Date.now())));

  return (
    <div className="app">
      <header className="topbar">
        <h1>積木城市</h1>
        <div className="stats">
          <span className="chip" title="今日三大建設：每天前三件事送道具">⭐ {bonusUsed}/{BONUS_PER_DAY}</span>
          <span className="chip" title="體力：開一關用 1 顆，過關退回">❤️ {game.hearts}</span>
          <span className="chip gold" title="目前關卡">🧱 第 {app.level} 關</span>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'tasks' && <TasksView app={app} />}
        {tab === 'game' && <GameView app={app} />}
        {tab === 'settings' && <SettingsView app={app} />}
      </main>

      <div className="toasts" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => app.dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
