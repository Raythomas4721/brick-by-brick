import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TOOLS, grow, hasRoadAccess, landmarkLevel, place, placeError, retireLandmark, stats, type Context, type Stats, type Tool,
} from './city/engine';
import { activeDays, isAway, rewardFor } from './economy/rewards';
import { PUSH_API } from './push/config';
import { disablePush, enablePush, reminderText, sendTestPush, syncReminders } from './push/client';
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
/** How far ahead reminders are uploaded to the push backend; refreshed every time the app opens. */
const PUSH_WINDOW_MS = 30 * DAY;

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
  const lastSynced = useRef('');
  const lastZoneHint = useRef(0);

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

  // ---- reminders: in-page alerts while the app is open ----
  const check = useCallback(() => {
    const now = Date.now();
    const due = remindersBetween(data.tasks, now - 6 * 3600_000, now).filter((r) => data.notified[r.key] !== r.at);
    if (due.length > 0) {
      for (const r of due) {
        const msg = `【${IMPORTANCE[r.task.importance].label}】${r.task.title}：${r.due > now ? formatRelative(r.due - now) : '時間到了'}`;
        toast(msg, 'alert');
        // with push on, the backend already sends a system notification
        if (!data.settings.pushEnabled && 'Notification' in window && Notification.permission === 'granted') {
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
  }, [data.tasks, data.notified, data.settings.pushEnabled, toast, update]);

  useEffect(() => {
    check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [check]);

  // ---- push: upload the next 30 days of reminders; the backend replaces the whole list ----
  const syncPush = useCallback(async () => {
    const d = ref.current;
    const s = d.settings;
    if (!s.pushEnabled || !s.pushDeviceId || !PUSH_API) return;
    const now = Date.now();
    const reminders = remindersBetween(d.tasks, now + 30_000, now + PUSH_WINDOW_MS)
      .slice(0, 400)
      .map((r) => ({ key: r.key, at: r.at, ...reminderText(r, s.pushShowTitle) }));
    const payload = JSON.stringify(reminders);
    if (payload === lastSynced.current) return;
    try {
      await syncReminders({ deviceId: s.pushDeviceId, secret: s.pushSecret }, reminders);
      lastSynced.current = payload;
    } catch {
      // offline or backend down: try again on the next change / interval / app open
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(syncPush, 1500);
    return () => clearTimeout(t);
  }, [data.tasks, data.settings, syncPush]);

  useEffect(() => {
    const t = setInterval(syncPush, 10 * 60_000);
    const onShow = () => document.visibilityState === 'visible' && syncPush();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [syncPush]);

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
    [toast, update],
  );

  const updateTask = useCallback(
    (id: string, input: TaskInput) => {
      update((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...input } : t)),
        notified: withoutTaskKeys(d.notified, id),
      }));
    },
    [update],
  );

  const deleteTask = useCallback(
    (id: string) => {
      update((d) => ({
        ...d,
        tasks: d.tasks.filter((t) => t.id !== id),
        city: retireLandmark(d.city, id),
        notified: withoutTaskKeys(d.notified, id),
      }));
    },
    [update],
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

      update((cur) => ({ ...cur, tasks, activity, city: growth.city, coins: cur.coins + reward.coins }));

      if (reward.welcomeBack) toast('🌅 市長回來了！城市醒過來了，回歸獎勵 +100', 'reward');
      toast(`✅ 完成！+${reward.coins - (reward.welcomeBack ? 100 : 0)} 💰${reward.bonus ? `　⭐ 今日三大建設 ${reward.bonusIndex}/3（金幣加倍）` : ''}`, 'reward');
      for (const e of growth.events) toast(e, 'reward');
      if (levelAfter > levelBefore) toast(`🏛️ ${CATEGORIES[task.category].building}升級到 ${levelAfter} 級！`, 'reward');
      if (growth.used === 0 && reward.growth > 0) toast('🏗️ 建設點先存著，劃一塊靠路的住宅區或商業區就會開始蓋');
    },
    [toast, update],
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
      const placed = city.cells[y * city.size + x];
      if ((tool === 'R' || tool === 'C') && placed.t === 'zone' && placed.level === 0 && Date.now() - lastZoneHint.current > 15_000) {
        lastZoneHint.current = Date.now();
        toast(hasRoadAccess(city, x, y) ? '🏗️ 空地劃好了！完成事項拿到建設點，這裡就會蓋起來' : '⚠️ 這塊空地沒接到道路，要緊鄰道路才會蓋房子');
      }
      return true;
    },
    [toast, update],
  );

  const renameCity = useCallback((name: string) => update((d) => ({ ...d, city: { ...d.city, name } })), [update]);

  // ---- settings / data ----
  const updateSettings = useCallback((patch: Partial<Settings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } })), [update]);

  /** Turn push on for this device (must be called from a tap). */
  const turnOnPush = useCallback(async () => {
    const s = ref.current.settings;
    try {
      const creds = await enablePush(s.pushDeviceId ? { deviceId: s.pushDeviceId, secret: s.pushSecret } : undefined);
      lastSynced.current = '';
      update((d) => ({ ...d, settings: { ...d.settings, pushEnabled: true, pushDeviceId: creds.deviceId, pushSecret: creds.secret } }));
      toast('🔔 推播通知已開啟', 'reward');
    } catch (e) {
      toast(e instanceof Error && e.message === 'permission' ? '通知權限被拒絕了，可到「設定 → 通知 → 積木城市」打開' : '開啟推播失敗，請稍後再試');
    }
  }, [toast, update]);

  const turnOffPush = useCallback(async () => {
    const s = ref.current.settings;
    if (s.pushDeviceId) await disablePush({ deviceId: s.pushDeviceId, secret: s.pushSecret });
    lastSynced.current = '';
    update((d) => ({ ...d, settings: { ...d.settings, pushEnabled: false, pushDeviceId: '', pushSecret: '' } }));
    toast('推播通知已關閉');
  }, [toast, update]);

  const testPush = useCallback(async () => {
    const s = ref.current.settings;
    try {
      await sendTestPush({ deviceId: s.pushDeviceId, secret: s.pushSecret });
      toast('已送出測試通知，幾秒內會跳出來');
    } catch (e) {
      toast(`測試失敗（${e instanceof Error ? e.message : '未知錯誤'}），可以先關閉再重新開啟推播`, 'alert');
    }
  }, [toast]);

  const replaceData = useCallback((next: AppData) => update(() => next), [update]);

  return {
    data, toasts, toast, dismissToast, ctx, cityStats, away,
    addTask, updateTask, deleteTask, completeTask,
    placeTile, renameCity,
    updateSettings, replaceData, turnOnPush, turnOffPush, testPush,
  };
}

export type AppApi = ReturnType<typeof useApp>;
