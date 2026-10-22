import { useEffect, useState } from 'react';
import { BONUS_PER_DAY, STREAK_TIERS, completionsOn } from '../economy/rewards';
import {
  CATEGORIES, IMPORTANCE, countOn, intervalSlots, isInterval, isOneOffDone, isRecurring, repeatLabel, streak, todayOccurrences,
  type Occurrence, type Task,
} from '../tasks/types';
import type { AppApi } from '../useApp';
import { addDays, dateTime, formatDate, formatRelative, localDate } from '../util';
import TaskForm from './TaskForm';

type Tab = 'today' | 'habits' | 'todos' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'habits', label: '習慣' },
  { id: 'todos', label: '單次事項' },
  { id: 'history', label: '紀錄' },
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function TaskTitle({ task }: { task: Task }) {
  return (
    <div className="task-title">
      <span title={CATEGORIES[task.category].label}>{CATEGORIES[task.category].icon}</span>
      <span className="imp-tag">{IMPORTANCE[task.importance].label}</span>
      <span>{task.title}</span>
    </div>
  );
}

/** The next slot today for an interval task, e.g. "14:00". */
function nextSlot(t: Task, now: number): string | null {
  if (!isInterval(t)) return null;
  const hhmm = new Date(now).toTimeString().slice(0, 5);
  return intervalSlots(t.repeat).find((x) => x > hhmm) ?? null;
}

function OccurrenceRow({ o, now, onComplete, onBump }: { o: Occurrence; now: number; onComplete: () => void; onBump: (d: 1 | -1) => void }) {
  const t = o.task;
  const due = t.time && o.date !== 'once' ? dateTime(o.date, t.time) : null;
  const s = isRecurring(t) ? streak(t, now) : 0;
  return (
    <li className={`card task ${o.done ? 'done' : ''}`} style={{ '--c': IMPORTANCE[t.importance].color } as React.CSSProperties}>
      <div className="task-main">
        <TaskTitle task={t} />
        {t.memo && <p className="memo">{t.memo}</p>}
        <div className="meta">
          {isRecurring(t) && <span>{repeatLabel(t)}</span>}
          {!isRecurring(t) && o.overdue && <span className="overdue">原定 {formatDate(t.date!)}，已逾期</span>}
          {due && !o.done && <span className={due < now ? 'overdue' : ''}>⏰ {t.time}（{formatRelative(due - now)}）</span>}
          {isInterval(t) && !o.done && nextSlot(t, now) && <span>⏰ 下次 {nextSlot(t, now)}</span>}
          {s > 0 && <span title="連續次數，每週可自動補一次">🔥 {s}</span>}
        </div>
      </div>
      {isInterval(t) ? (
        <div className="counter" aria-label="今天的次數">
          <button className="ghost" onClick={() => onBump(-1)} disabled={countOn(t, o.date) === 0} aria-label="減一">－</button>
          <span className={o.done ? 'count done-mark' : 'count'}>{countOn(t, o.date)}／{t.repeat.goal}{o.done ? ' ✓' : ''}</span>
          <button className="primary" onClick={() => onBump(1)} aria-label="加一">＋1</button>
        </div>
      ) : o.done ? <span className="done-mark">✓ 完成</span> : <button className="primary" onClick={onComplete}>完成</button>}
    </li>
  );
}

function nextMilestone(s: number): string {
  const next = STREAK_TIERS.find((n) => s < n);
  return next ? `再 ${next - s} 次拿 💎 彩虹積木` : '已拿到所有里程碑獎勵';
}

export default function TasksView({ app }: { app: AppApi }) {
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>('today');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const { tasks, activity } = app.data;
  const today = localDate(now);

  const occurrences = todayOccurrences(tasks, now).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ta = a.task.time ?? '99:99';
    const tb = b.task.time ?? '99:99';
    return ta.localeCompare(tb) || b.task.importance - a.task.importance;
  });
  const habits = tasks.filter(isRecurring);
  const todos = tasks
    .filter((t) => !isRecurring(t) && !isOneOffDone(t))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '').localeCompare(b.time ?? ''));
  const doneTodos = tasks.filter(isOneOffDone);

  const edit = (t: Task) => (
    <TaskForm
      initial={t}
      onSubmit={(input) => {
        app.updateTask(t.id, input);
        setEditing(null);
      }}
      onCancel={() => setEditing(null)}
    />
  );

  const actions = (t: Task) => (
    <div className="task-actions">
      <button className="ghost" onClick={() => setEditing(t.id)}>編輯</button>
      <button
        className="ghost danger"
        onClick={() => confirm(`刪除「${t.title}」？`) && app.deleteTask(t.id)}
      >
        刪除
      </button>
    </div>
  );

  const bonusUsed = Math.min(BONUS_PER_DAY, completionsOn(activity, today));

  return (
    <div className="tasks">
      {perm === 'default' && (
        <div className="banner">
          <span>開啟桌面通知，網頁開著時時間到會跳提醒。</span>
          <button className="primary" onClick={async () => setPerm(await Notification.requestPermission())}>開啟通知</button>
        </div>
      )}

      <div className="row spread">
        <div className="tabs-inline" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => setAdding((v) => !v)}>{adding ? '收起' : '＋ 新增'}</button>
      </div>

      {adding && (
        <TaskForm
          onSubmit={(input) => {
            app.addTask(input);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {tab === 'today' && (
        <>
          <p className="hint">⭐ 今日三大建設 {bonusUsed}/{BONUS_PER_DAY}：每天前三件完成的事，除了 ❤️ 還會送一個道具。</p>
          {occurrences.length === 0 && <p className="empty">今天沒有排定的事項。按「＋ 新增」記一件吧 ✨</p>}
          <ul className="task-list">
            {occurrences.map((o) => (editing === o.task.id ? <li key={o.task.id}>{edit(o.task)}</li> : <OccurrenceRow key={o.task.id} o={o} now={now} onComplete={() => app.completeTask(o.task.id, o.date)} onBump={(d) => app.bumpCount(o.task.id, d)} />))}
          </ul>
        </>
      )}

      {tab === 'habits' && (
        <>
          {habits.length === 0 && <p className="empty">還沒有習慣。新增時選「每天／每週／每月／間隔」就會出現在這裡。</p>}
          <ul className="task-list">
            {habits.map((t) => {
              if (editing === t.id) return <li key={t.id}>{edit(t)}</li>;
              const s = streak(t, now);
              return (
                <li key={t.id} className="card task" style={{ '--c': IMPORTANCE[t.importance].color } as React.CSSProperties}>
                  <div className="task-main">
                    <TaskTitle task={t} />
                    <div className="meta">
                      <span>{repeatLabel(t)}</span>
                      <span>🔥 連續 {s} 次</span>
                    </div>
                    <div className="meta">
                      <span>{nextMilestone(s)}</span>
                    </div>
                  </div>
                  {actions(t)}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'todos' && (
        <>
          {todos.length === 0 && <p className="empty">沒有待辦的單次事項。</p>}
          <ul className="task-list">
            {todos.map((t) =>
              editing === t.id ? (
                <li key={t.id}>{edit(t)}</li>
              ) : (
                <li key={t.id} className="card task" style={{ '--c': IMPORTANCE[t.importance].color } as React.CSSProperties}>
                  <div className="task-main">
                    <TaskTitle task={t} />
                    {t.memo && <p className="memo">{t.memo}</p>}
                    <div className="meta">
                      <span className={t.date && t.date < today ? 'overdue' : ''}>📅 {repeatLabel(t)}</span>
                    </div>
                  </div>
                  <div className="task-actions">
                    <button className="primary" onClick={() => app.completeTask(t.id, t.date ?? 'once')}>完成</button>
                    {actions(t)}
                  </div>
                </li>
              ),
            )}
          </ul>
        </>
      )}

      {tab === 'history' && (
        <>
          <div className="card history">
            <h3>最近 14 天</h3>
            <div className="bars">
              {Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => {
                const n = completionsOn(activity, d);
                return (
                  <div key={d} className="bar" title={`${formatDate(d)}：完成 ${n} 件`}>
                    <span style={{ height: `${Math.min(100, n * 20)}%` }} />
                    <small>{Number(d.slice(8))}</small>
                  </div>
                );
              })}
            </div>
          </div>
          <h3 className="section-title">完成的單次事項</h3>
          {doneTodos.length === 0 && <p className="empty">還沒有。</p>}
          <ul className="task-list">
            {doneTodos.map((t) => (
              <li key={t.id} className="card task done" style={{ '--c': IMPORTANCE[t.importance].color } as React.CSSProperties}>
                <div className="task-main">
                  <TaskTitle task={t} />
                  <div className="meta"><span>{repeatLabel(t)}</span></div>
                </div>
                {actions(t)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
