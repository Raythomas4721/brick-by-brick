import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TOOLS, grow, landmarkLevel, place, placeError, retireLandmark, stats, type Context, type Stats, type Tool,
} from './city/engine';
import { activeDays, isAway, rewardFor } from './economy/rewards';
import { NTFY_MIN_DELAY_MS, NTFY_WINDOW_MS, cancelNtfy, scheduleNtfy } from './reminders/ntfy';
import { load, save, type AppData, type Settings } from './storage';
import {
  CATEGORIES, IMPORTANCE, isRecurring, remindersBetween, streak, type Category, type Importance, type Repeat, type Task,
} from './tasks/types';
import { formatRelative, localDate, newId } from './util';

export interface TaskInput {
  title: string;
  memo: string;
  category: Category;
  importance: Importance;
  repeat: Repeat;
  date: string | null;
  time: string | null;
  remindBefore: number;
}

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'reward' | 'alert';
}

const CHECK_INTERVAL_MS = 30_000;
const DAY = 86_400_000;

export function cityContext(tasks: Task[], activity: AppData['activity'], now: number): Context {
  const landmarkLevels: Record<string, number> = {};
  for (const t of tasks) if (isRecurring(t)) landmarkLevels[t.id] = landmarkLevel(streak(t, now));
  return { activeDays: activeDays(activity, now), landmarkLevels };
}

/** Drop bookkeeping for reminders older than a day. */
function prune(map: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter(([, at]) => at > now - DAY));
}

export function useApp() {
  const [data, setData] = useState<AppData>(load);
  // Every write goes through `update` so back-to-back calls (e.g. drag-painting roads) see each other's result.
  const ref = useRef(data);
  const update = useCallback((fn: (d: AppData) => AppData) => {
    const next = fn(ref.current);
    if (next === ref.current) return;
    ref.current = next;
    setData(next);
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const inFlight = useRef(new Set<string>());

  useEffect(() => save(data), [data]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = newId();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'alert' ? 10_000 : 4_500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const now = Date.now();
  const ctx = useMemo(() => cityContext(data.tasks, data.activity, now), [data.tasks, data.activity, Math.floor(now / 60_000)]);
  const cityStats: Stats = useMemo(() => stats(data.city, ctx), [data.city, ctx]);
  const away = isAway(data.activity, now);

  // ---- reminders: in-page notifications + keeping ntfy's 3-day queue topped up ----
  const check = useCallback(() => {
    const now = Date.now();
    const due = remindersBetween(data.tasks, now - 6 * 3600_000, now).filter((r) => data.notified[r.key] !== r.at);
    if (due.length > 0) {
      for (const r of due) {
        const msg = `【${IMPORTANCE[r.task.importance].label}】${r.task.title}：${r.due > now ? formatRelative(r.due - now) : '時間到了'}`;
        toast(msg, 'alert');
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('城市提醒', { body: msg, tag: r.key });
          } catch {
            // some browsers only allow notifications from a service worker
          }
        }
      }
      update((d) => ({
        ...d,
        notified: { ...prune(d.notified, now), ...Object.fromEntries(due.map((r) => [r.key, r.at])) },
      }));
    }

    if (data.settings.ntfyEnabled && data.settings.ntfyTopic) {
      const upcoming = remindersBetween(data.tasks, now + NTFY_MIN_DELAY_MS, now + NTFY_WINDOW_MS);
      for (const r of upcoming) {
        if (data.ntfy[r.key] === r.at || inFlight.current.has(r.key)) continue;
        inFlight.current.add(r.key);
        scheduleNtfy(data.settings, r)
          .then(() => update((d) => ({ ...d, ntfy: { ...prune(d.ntfy, Date.now()), [r.key]: r.at } })))
          .catch(() => toast('ntfy 推播排程失敗，請檢查設定或網路'))
          .finally(() => inFlight.current.delete(r.key));
      }
    }
  }, [data.tasks, data.notified, data.ntfy, data.settings, toast]);

  useEffect(() => {
    check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [check]);

  /** Cancel queued pushes for a task (all occurrences, or one key). */
  const cancelPushes = useCallback(
    (taskId: string, onlyKey?: string) => {
      const now = Date.now();
      for (const [key, at] of Object.entries(data.ntfy)) {
        if ((onlyKey ? key === onlyKey : key.startsWith(`${taskId}_`)) && at > now) cancelNtfy(data.settings, key);
      }
    },
    [data.ntfy, data.settings],
  );

  function withoutTaskKeys(map: Record<string, number>, taskId: string) {
    return Object.fromEntries(Object.entries(map).filter(([k]) => !k.startsWith(`${taskId}_`)));
  }

  // ---- tasks ----
  const addTask = useCallback(
    (input: TaskInput) => {
      const task: Task = { id: newId(), ...input, createdAt: Date.now(), done: [] };
      update((d) => ({ ...d, tasks: [task, ...d.tasks] }));
      toast(isRecurring(task) ? `已新增習慣，記得到城市幫它放一座${CATEGORIES[task.category].building}` : '已新增事項');
    },
    [toast],
  );

  const updateTask = useCallback(
    (id: string, input: TaskInput) => {
      cancelPushes(id);
      update((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...input } : t)),
        ntfy: withoutTaskKeys(d.ntfy, id),
        notified: withoutTaskKeys(d.notified, id),
      }));
    },
    [cancelPushes],
  );

  const deleteTask = useCallback(
    (id: string) => {
      cancelPushes(id);
      update((d) => ({
        ...d,
        tasks: d.tasks.filter((t) => t.id !== id),
        city: retireLandmark(d.city, id),
        ntfy: withoutTaskKeys(d.ntfy, id),
        notified: withoutTaskKeys(d.notified, id),
      }));
    },
    [cancelPushes],
  );

  const completeTask = useCallback(
    (id: string, date: string) => {
      const d = ref.current;
      const task = d.tasks.find((t) => t.id === id);
      if (!task || task.done.includes(date)) return;
      const now = Date.now();
      const today = localDate(now);
      const late = !isRecurring(task) && task.date !== null && task.date < today;
      const reward = rewardFor(task, d.activity, now, late);
      const updated = { ...task, done: [...task.done, date] };
      const levelBefore = landmarkLevel(streak(task, now));
      const levelAfter = landmarkLevel(streak(updated, now));
      const tasks = d.tasks.map((t) => (t.id === id ? updated : t));
      const activity = { ...d.activity, [today]: (d.activity[today] ?? 0) + 1 };
      const growth = grow(d.city, reward.growth, cityContext(tasks, activity, now));
      cancelPushes(id, `${id}_${date.replace(/-/g, '')}`);

      update((cur) => ({ ...cur, tasks, activity, city: growth.city, coins: cur.coins + reward.coins }));

      if (reward.welcomeBack) toast('🌅 市長回來了！城市醒過來了，回歸獎勵 +100', 'reward');
      toast(`✅ 完成！+${reward.coins - (reward.welcomeBack ? 100 : 0)} 💰${reward.bonus ? `　⭐ 今日三大建設 ${reward.bonusIndex}/3（金幣加倍）` : ''}`, 'reward');
      for (const e of growth.events) toast(e, 'reward');
      if (levelAfter > levelBefore) toast(`🏛️ ${CATEGORIES[task.category].building}升級到 ${levelAfter} 級！`, 'reward');
      if (growth.used === 0 && reward.growth > 0) toast('🏗️ 建設點先存著，劃一塊靠路的住宅區或商業區就會開始蓋');
    },
    [cancelPushes, toast, update],
  );

  // ---- city ----
  const placeTile = useCallback(
    (tool: Tool, x: number, y: number, taskId?: string): boolean => {
      if (tool === 'inspect') return false;
      const d = ref.current;
      if (placeError(d.city, tool, x, y)) return false;
      const cost = TOOLS[tool].cost;
      if (d.coins < cost) {
        toast(`金幣不夠，${TOOLS[tool].label}需要 ${cost} 💰`);
        return false;
      }
      let city = place(d.city, tool, x, y, taskId);
      let events: string[] = [];
      if ((tool === 'R' || tool === 'C' || tool === 'road') && city.bank > 0) {
        const g = grow(city, 0, cityContext(d.tasks, d.activity, Date.now()));
        city = g.city;
        events = g.events;
      }
      update((cur) => ({ ...cur, city, coins: cur.coins - cost }));
      for (const e of events) toast(e, 'reward');
      return true;
    },
    [toast, update],
  );

  const renameCity = useCallback((name: string) => update((d) => ({ ...d, city: { ...d.city, name } })), [update]);

  // ---- settings / data ----
  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const old = data.settings;
      const next = { ...old, ...patch };
      const destinationChanged = next.ntfyTopic !== old.ntfyTopic || next.ntfyServer !== old.ntfyServer;
      const now = Date.now();
      // pushes already queued at the old destination (or after turning ntfy off) would still fire
      if (old.ntfyEnabled && (destinationChanged || !next.ntfyEnabled)) {
        for (const [key, at] of Object.entries(data.ntfy)) if (at > now) cancelNtfy(old, key);
      }
      const reschedule = destinationChanged || next.ntfyEnabled !== old.ntfyEnabled || next.ntfyShowTitle !== old.ntfyShowTitle;
      update((d) => ({ ...d, settings: next, ntfy: reschedule ? {} : d.ntfy }));
    },
    [data.settings, data.ntfy],
  );

  const replaceData = useCallback((next: AppData) => update(() => next), [update]);

  return {
    data, toasts, toast, dismissToast, ctx, cityStats, away,
    addTask, updateTask, deleteTask, completeTask,
    placeTile, renameCity,
    updateSettings, replaceData,
  };
}

export type AppApi = ReturnType<typeof useApp>;
