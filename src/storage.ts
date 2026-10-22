import { HEART_CAP, type Activity, type Booster } from './economy/rewards';
import type { Game } from './game/match3';
import { ONCE, type Importance, type Task } from './tasks/types';
import { localDate } from './util';

export interface Settings {
  pushEnabled: boolean;
  pushDeviceId: string;
  pushSecret: string; // proves this device owns its reminders on the push backend
  pushShowTitle: boolean;
}

export interface GameProgress {
  hearts: number;
  boosters: Record<Booster, number>;
  stars: Record<string, number>; // level -> best stars (1-3)
  current: Game | null; // level in progress, resumed after a reload
  freeHeartsOn: string; // date the daily free hearts were last given
}

export interface AppData {
  version: 3;
  tasks: Task[];
  game: GameProgress;
  activity: Activity; // completions per day
  notified: Record<string, number>; // reminder key -> time shown in the page
  settings: Settings;
}

const KEY = 'brick-by-brick:v3';
const V2_KEY = 'habit-city:v2';
const V1_KEY = 'todo-monopoly:v1';
export const START_HEARTS = 5;

export function defaultSettings(): Settings {
  return { pushEnabled: false, pushDeviceId: '', pushSecret: '', pushShowTitle: false };
}

export function emptyGame(hearts = START_HEARTS): GameProgress {
  return {
    hearts: Math.min(HEART_CAP, hearts),
    boosters: { hammer: 1, shuffle: 1, moves: 1, rainbow: 0 },
    stars: {},
    current: null,
    freeHeartsOn: '',
  };
}

export function emptyData(): AppData {
  return { version: 3, tasks: [], game: emptyGame(), activity: {}, notified: {}, settings: defaultSettings() };
}

/** Highest unlocked level: one past the best cleared level. */
export function currentLevel(game: GameProgress): number {
  const cleared = Object.keys(game.stars).map(Number);
  return cleared.length ? Math.max(...cleared) + 1 : 1;
}

/** Fill in fields added after the data was saved and drop anything unknown. */
function withDefaults(d: AppData): AppData {
  const { pushEnabled, pushDeviceId, pushSecret, pushShowTitle } = { ...defaultSettings(), ...d.settings };
  const base = emptyGame();
  return {
    version: 3,
    tasks: d.tasks ?? [],
    game: { ...base, ...d.game, boosters: { ...base.boosters, ...d.game?.boosters } },
    activity: d.activity ?? {},
    notified: d.notified ?? {},
    settings: { pushEnabled, pushDeviceId, pushSecret, pushShowTitle },
  };
}

function isV3(v: unknown): v is AppData {
  const d = v as AppData;
  return !!d && d.version === 3 && Array.isArray(d.tasks) && !!d.game && !!d.settings;
}

/** City version: keep tasks, history and push settings; coins become hearts (50 each). */
function migrateV2(old: any): AppData {
  return withDefaults({
    version: 3,
    tasks: old.tasks ?? [],
    game: emptyGame(START_HEARTS + Math.floor((old.coins ?? 0) / 50)),
    activity: old.activity ?? {},
    notified: old.notified ?? {},
    settings: old.settings ?? defaultSettings(),
  });
}

interface OldNote {
  id: string;
  title: string;
  memo: string;
  dueAt: number | null;
  remindBefore: number;
  importance: Importance;
  createdAt: number;
  completedAt: number | null;
}

/** Monopoly version: notes become one-off tasks, dice and coins become hearts. */
function migrateV1(old: any): AppData {
  const data = emptyData();
  const coins = (old.wallet?.pendingCoins ?? 0) + 50 * ((old.wallet?.normalDice ?? 0) + (old.wallet?.goldDice ?? 0));
  data.game = emptyGame(START_HEARTS + Math.floor(coins / 50));
  data.tasks = ((old.notes ?? []) as OldNote[]).map((n) => {
    const date = n.dueAt ? localDate(n.dueAt) : null;
    const time = n.dueAt ? new Date(n.dueAt).toTimeString().slice(0, 5) : null;
    return {
      id: n.id, title: n.title, memo: n.memo, category: 'life', importance: n.importance,
      repeat: { kind: 'none' }, date, time, remindBefore: n.remindBefore, createdAt: n.createdAt,
      done: n.completedAt ? [date ?? ONCE] : [],
    };
  });
  return data;
}

/** Accept any saved/exported version and bring it up to v3. */
export function upgrade(parsed: any): AppData | null {
  if (isV3(parsed)) return withDefaults(parsed);
  if (parsed?.version === 2 && Array.isArray(parsed.tasks)) return migrateV2(parsed);
  if (parsed?.version === 1 && Array.isArray(parsed.notes)) return migrateV1(parsed);
  return null;
}

export function load(): AppData {
  try {
    for (const key of [KEY, V2_KEY, V1_KEY]) {
      const raw = localStorage.getItem(key);
      const data = raw ? upgrade(JSON.parse(raw)) : null;
      if (data) return data;
    }
  } catch {
    // unreadable storage: start fresh
  }
  return emptyData();
}

export function save(data: AppData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked; nothing we can do here
  }
}

export function exportJson(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export function importJson(text: string): AppData {
  const data = upgrade(JSON.parse(text));
  if (!data) throw new Error('檔案格式不正確');
  return data;
}
