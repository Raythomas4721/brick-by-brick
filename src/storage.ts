import { newCity, type City } from './city/engine';
import type { Activity } from './economy/rewards';
import { ONCE, type Importance, type Task } from './tasks/types';
import { localDate } from './util';

export interface Settings {
  ntfyEnabled: boolean;
  ntfyServer: string;
  ntfyTopic: string;
  ntfyShowTitle: boolean;
}

export interface AppData {
  version: 2;
  tasks: Task[];
  city: City;
  coins: number;
  activity: Activity; // completions per day
  notified: Record<string, number>; // reminder key -> time shown in the page
  ntfy: Record<string, number>; // reminder key -> time scheduled on ntfy
  settings: Settings;
}

const KEY = 'habit-city:v2';
const OLD_KEY = 'todo-monopoly:v1';
export const START_COINS = 300;

export function randomTopic(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join('');
  return `todo-${s.slice(0, 6)}-${s.slice(6)}`;
}

export function emptyData(): AppData {
  return {
    version: 2,
    tasks: [],
    city: newCity('我的城市', (Math.random() * 2 ** 31) | 0),
    coins: START_COINS,
    activity: {},
    notified: {},
    ntfy: {},
    settings: { ntfyEnabled: false, ntfyServer: 'https://ntfy.sh', ntfyTopic: randomTopic(), ntfyShowTitle: false },
  };
}

function isAppData(v: unknown): v is AppData {
  const d = v as AppData;
  return !!d && d.version === 2 && Array.isArray(d.tasks) && !!d.city && !!d.settings;
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

/** Carry notes and coins over from the Monopoly version. */
function migrateV1(old: any): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, ...(old.settings ?? {}) };
  data.coins += (old.wallet?.pendingCoins ?? 0) + 50 * ((old.wallet?.normalDice ?? 0) + (old.wallet?.goldDice ?? 0));
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

export function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isAppData(parsed)) return { ...emptyData(), ...parsed };
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateV1(JSON.parse(old));
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
  const parsed = JSON.parse(text);
  if (!isAppData(parsed)) throw new Error('檔案格式不正確');
  return { ...emptyData(), ...parsed };
}
