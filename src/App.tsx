import { useState } from 'react';
import CityView from './components/CityView';
import SettingsView from './components/SettingsView';
import TasksView from './components/TasksView';
import { BONUS_PER_DAY, completionsOn } from './economy/rewards';
import { useApp } from './useApp';
import { localDate } from './util';

type Tab = 'tasks' | 'city' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'tasks', label: '📝 記事本' },
  { id: 'city', label: '🏙️ 我的城市' },
  { id: 'settings', label: '⚙️ 設定' },
];

export default function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('tasks');
  const { coins, activity } = app.data;
  const bonusUsed = Math.min(BONUS_PER_DAY, completionsOn(activity, localDate(Date.now())));

  return (
    <div className="app">
      <header className="topbar">
        <h1>積木城市</h1>
        <div className="stats">
          <span className="chip" title="今日三大建設：每天前三件事加倍">⭐ {bonusUsed}/{BONUS_PER_DAY}</span>
          <span className="chip" title="人口">👥 {app.cityStats.population}</span>
          <span className="chip" title="幸福度">😊 {app.cityStats.happiness}</span>
          <span className="chip gold" title="金幣">💰 {coins}</span>
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
        {tab === 'tasks' && <TasksView app={app} onGoCity={() => setTab('city')} />}
        {tab === 'city' && <CityView app={app} />}
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
