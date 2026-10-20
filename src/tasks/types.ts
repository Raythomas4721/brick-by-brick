import { addDays, dateTime, dayOfMonth, daysInMonth, localDate, weekStart, weekday } from '../util';

export type Importance = 1 | 2 | 3 | 4;
export type Category = 'health' | 'study' | 'life' | 'work';

export const IMPORTANCE: Record<Importance, { label: string; color: string; coins: number; ntfyPriority: number }> = {
  1: { label: '低', color: 'var(--imp-1)', coins: 30, ntfyPriority: 2 },
  2: { label: '中', color: 'var(--imp-2)', coins: 40, ntfyPriority: 3 },
  3: { label: '高', color: 'var(--imp-3)', coins: 50, ntfyPriority: 4 },
  4: { label: '緊急', color: 'var(--imp-4)', coins: 60, ntfyPriority: 5 },
};

export const CATEGORIES: Record<Category, { label: string; icon: string; building: string }> = {
  health: { label: '健康', icon: '🏃', building: '健身中心' },
  study: { label: '學習', icon: '📚', building: '圖書館' },
  life: { label: '生活', icon: '🏠', building: '社區中心' },
  work: { label: '工作', icon: '💼', building: '商業大樓' },
};

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const REMIND_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: '準時' },
  { minutes: 10, label: '10 分鐘前' },
  { minutes: 30, label: '30 分鐘前' },
  { minutes: 60, label: '1 小時前' },
  { minutes: 180, label: '3 小時前' },
  { minutes: 1440, label: '1 天前' },
];

export type Repeat =
  | { kind: 'none' }
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] } // 0 = Sunday
  | { kind: 'monthly'; day: number };

export interface Task {
  id: string;
  title: string;
  memo: string;
  category: Category;
  importance: Importance;
  repeat: Repeat;
  date: string | null; // one-off only: YYYY-MM-DD, null = no date
  time: string | null; // HH:MM; null = no reminder
  remindBefore: number; // minutes
  createdAt: number;
  done: string[]; // completed occurrence dates; one-off tasks use their date or "once"
}

export const ONCE = 'once';

export function isRecurring(t: Task): boolean {
  return t.repeat.kind !== 'none';
}

export function occursOn(t: Task, date: string): boolean {
  const r = t.repeat;
  if (r.kind === 'none') return t.date === date;
  if (date < localDate(t.createdAt)) return false;
  if (r.kind === 'daily') return true;
  if (r.kind === 'weekly') return r.days.includes(weekday(date));
  return dayOfMonth(date) === Math.min(r.day, daysInMonth(date));
}

/** The occurrence key a one-off task is completed under. */
export function onceKey(t: Task): string {
  return t.date ?? ONCE;
}

export function isOneOffDone(t: Task): boolean {
  return !isRecurring(t) && t.done.length > 0;
}

export function dueAt(t: Task, date: string): number | null {
  return t.time ? dateTime(date, t.time) : null;
}

export function repeatLabel(t: Task): string {
  const r = t.repeat;
  const time = t.time ? ` ${t.time}` : '';
  if (r.kind === 'daily') return `每天${time}`;
  if (r.kind === 'weekly') {
    const days = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    return `每週${days.map((d) => WEEKDAYS[d]).join('、')}${time}`;
  }
  if (r.kind === 'monthly') return `每月 ${r.day} 號${time}`;
  return t.date ? `${Number(t.date.slice(5, 7))}/${Number(t.date.slice(8, 10))}${time}` : '無期限';
}

export interface Occurrence {
  task: Task;
  date: string; // occurrence date, or "once" for undated one-offs
  done: boolean;
  overdue: boolean;
}

/** What shows up on the "today" list. */
export function todayOccurrences(tasks: Task[], now: number): Occurrence[] {
  const today = localDate(now);
  const out: Occurrence[] = [];
  for (const t of tasks) {
    if (isRecurring(t)) {
      if (occursOn(t, today)) out.push({ task: t, date: today, done: t.done.includes(today), overdue: false });
      continue;
    }
    const key = onceKey(t);
    const done = t.done.includes(key);
    if (t.date === today) out.push({ task: t, date: key, done, overdue: false });
    else if (!done && (t.date === null || t.date < today)) out.push({ task: t, date: key, done, overdue: t.date !== null });
  }
  return out;
}

/**
 * Consecutive completed occurrences up to today. Today counts only once done.
 * One missed occurrence per week is forgiven automatically (市政假日).
 */
export function streak(t: Task, now: number): number {
  if (!isRecurring(t)) return 0;
  const today = localDate(now);
  const start = localDate(t.createdAt);
  const done = new Set(t.done);
  const forgiven = new Set<string>();
  let count = 0;
  for (let d = today, i = 0; d >= start && i < 800; d = addDays(d, -1), i++) {
    if (!occursOn(t, d)) continue;
    if (done.has(d)) {
      count++;
    } else if (d === today) {
      continue; // still time left today
    } else {
      const week = weekStart(d);
      if (forgiven.has(week)) break;
      forgiven.add(week);
    }
  }
  return count;
}

export interface Reminder {
  key: string; // unique per occurrence, also the ntfy sequence id
  task: Task;
  date: string;
  at: number; // when to remind
  due: number;
}

export function reminderKey(taskId: string, date: string): string {
  return `${taskId}_${date.replace(/-/g, '')}`;
}

/** Reminders whose time falls in [from, to], skipping completed occurrences. */
export function remindersBetween(tasks: Task[], from: number, to: number): Reminder[] {
  const out: Reminder[] = [];
  const first = localDate(from - 86_400_000);
  const last = addDays(localDate(to), 2); // remindBefore can be up to a day early
  for (const t of tasks) {
    if (!t.time) continue;
    const dates = isRecurring(t) ? [] : t.date ? [t.date] : [];
    if (isRecurring(t)) for (let d = first; d <= last; d = addDays(d, 1)) if (occursOn(t, d)) dates.push(d);
    for (const d of dates) {
      if (t.done.includes(d)) continue;
      const due = dateTime(d, t.time);
      const at = due - t.remindBefore * 60_000;
      if (at >= from && at <= to) out.push({ key: reminderKey(t.id, d), task: t, date: d, at, due });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
