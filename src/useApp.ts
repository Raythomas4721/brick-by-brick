import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOOSTERS, DAILY_FREE_HEARTS, HEART_CAP, isAway, randomBooster, rewardFor, streakTier, type Booster,
} from './economy/rewards';
import { levelConfig } from './game/levels';
import { newGame, type Game } from './game/match3';
import { PUSH_API } from './push/config';
import { disablePush, enablePush, reminderText, sendTestPush, syncReminders } from './push/client';
import { currentLevel, load, save, type AppData, type GameProgress, type Settings } from './storage';
import {
  IMPORTANCE, countOn, isInterval, isRecurring, remindersBetween, streak, type Category, type Importance, type Repeat, type Task,
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
/** Interval tasks (e.g. hourly water) remind many times a day, so only a week ahead is uploaded. */
const PUSH_INTERVAL_WINDOW_MS = 7 * DAY;
const PUSH_MAX = 1000;

const addHearts = (g: GameProgress, n: number): GameProgress => ({ ...g, hearts: Math.min(HEART_CAP, g.hearts + n) });
const addBooster = (g: GameProgress, b: Booster, n = 1): GameProgress => ({ ...g, boosters: { ...g.boosters, [b]: g.boosters[b] + n } });

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

  useEffect(() => save(data), [data]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = newId();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'alert' ? 10_000 : 4_500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const level = useMemo(() => currentLevel(data.game), [data.game]);

  // ---- daily free hearts: a little play every day, even without finishing anything ----
  useEffect(() => {
    const give = () => {
      const today = localDate(Date.now());
      if (ref.current.game.freeHeartsOn === today) return;
      update((d) => ({ ...d, game: { ...addHearts(d.game, DAILY_FREE_HEARTS), freeHeartsOn: today } }));
      toast(`🎁 今天的免費體力 ❤️ +${DAILY_FREE_HEARTS}`, 'reward');
    };
    give();
    const onShow = () => document.visibilityState === 'visible' && give();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [toast, update]);

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
            new Notification('積木城市', { body: msg, tag: r.key });
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
    const reminders = remindersBetween(d.tasks, now + 30_000, now + PUSH_WINDOW_MS, now + PUSH_INTERVAL_WINDOW_MS)
      .slice(0, PUSH_MAX)
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
      toast(isRecurring(task) ? '已新增習慣，連續 7／30／100 次會拿到 💎 彩虹積木' : '已新增事項');
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
      const milestone = isRecurring(task) && streakTier(streak(updated, now)) > streakTier(streak(task, now));
      const activity = { ...d.activity, [today]: (d.activity[today] ?? 0) + 1 };

      update((cur) => {
        let game = addHearts(cur.game, reward.hearts);
        if (reward.booster) game = addBooster(game, reward.booster);
        if (milestone) game = addBooster(game, 'rainbow');
        return { ...cur, tasks: cur.tasks.map((t) => (t.id === id ? updated : t)), activity, game };
      });

      if (reward.welcomeBack) toast('🌅 歡迎回來！回歸禮 ❤️ +3', 'reward');
      toast(`✅ 完成！❤️ +1${reward.booster ? `　⭐ 今日三大建設 ${reward.bonusIndex}/3：${BOOSTERS[reward.booster].icon} ${BOOSTERS[reward.booster].label}` : ''}`, 'reward');
      if (milestone) toast(`💎 「${task.title}」連續 ${streak(updated, now)} 次！獲得彩虹積木`, 'reward');
    },
    [toast, update],
  );

  /** Interval tasks: count one more (or one fewer) for today; reaching the goal completes the day. */
  const bumpCount = useCallback(
    (id: string, delta: 1 | -1) => {
      const task = ref.current.tasks.find((t) => t.id === id);
      if (!task || !isInterval(task)) return;
      const today = localDate(Date.now());
      const n = Math.max(0, countOn(task, today) + delta);
      update((cur) => ({
        ...cur,
        tasks: cur.tasks.map((t) => (t.id === id ? { ...t, counts: { ...(t.counts ?? {}), [today]: n } } : t)),
      }));
      if (delta > 0 && n >= task.repeat.goal && !task.done.includes(today)) completeTask(id, today);
    },
    [completeTask, update],
  );

  // ---- game ----
  /** Start a level; costs one heart (refunded on a win). */
  const startLevel = useCallback(
    (n: number): boolean => {
      const g = ref.current.game;
      if (g.hearts < 1) {
        toast('體力不夠了，完成一件事就能拿到 ❤️');
        return false;
      }
      update((d) => ({ ...d, game: { ...d.game, hearts: d.game.hearts - 1, current: newGame(levelConfig(n)) } }));
      return true;
    },
    [toast, update],
  );

  /** Keep the in-progress level so a reload resumes it. */
  const saveGame = useCallback((current: Game) => update((d) => ({ ...d, game: { ...d.game, current } })), [update]);

  /** A level ended (won or lost): refund the heart and record stars on a win. */
  const finishLevel = useCallback(
    (result: Game) => {
      if (result.status === 'won') {
        const cfg = levelConfig(result.level);
        const bonus = cfg.bonus ? randomBooster(Math.random()) : null;
        update((d) => {
          let game = addHearts(d.game, 1);
          game = { ...game, current: null, stars: { ...game.stars, [result.level]: Math.max(game.stars[result.level] ?? 0, result.stars) } };
          if (bonus) game = addBooster(game, bonus);
          return { ...d, game };
        });
        if (bonus) toast(`🎉 大關獎勵：${BOOSTERS[bonus].icon} ${BOOSTERS[bonus].label}`, 'reward');
      } else {
        update((d) => ({ ...d, game: { ...d.game, current: null } }));
      }
    },
    [toast, update],
  );

  /** Spend one booster; returns false when there are none left. */
  const spendBooster = useCallback(
    (b: Booster): boolean => {
      if (ref.current.game.boosters[b] < 1) return false;
      update((d) => ({ ...d, game: addBooster(d.game, b, -1) }));
      return true;
    },
    [update],
  );

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
    data, toasts, toast, dismissToast, level, away: isAway(data.activity, Date.now()),
    addTask, updateTask, deleteTask, completeTask, bumpCount,
    startLevel, saveGame, finishLevel, spendBooster,
    updateSettings, replaceData, turnOnPush, turnOffPush, testPush,
  };
}

export type AppApi = ReturnType<typeof useApp>;
