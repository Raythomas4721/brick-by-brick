import { IMPORTANCE, type Task } from '../tasks/types';
import { addDays, daysBetween, localDate } from '../util';

/** The first three completions each day are the day's "三大建設". */
export const BONUS_PER_DAY = 3;
export const WELCOME_BACK_DAYS = 3;
export const WELCOME_BACK_COINS = 100;

/** Completions per local date. */
export type Activity = Record<string, number>;

export function completionsOn(activity: Activity, date: string): number {
  return activity[date] ?? 0;
}

export interface Reward {
  coins: number;
  growth: number; // construction ticks for the city
  bonus: boolean; // one of today's first three
  bonusIndex: number; // 1-3 when bonus
  late: boolean;
  welcomeBack: boolean;
}

/**
 * Reward for completing `task`. `late` = a dated one-off finished after its day.
 * Late completions still pay, just without the daily bonus.
 */
export function rewardFor(task: Task, activity: Activity, now: number, late: boolean): Reward {
  const today = localDate(now);
  const doneToday = completionsOn(activity, today);
  const bonus = !late && doneToday < BONUS_PER_DAY;
  const base = IMPORTANCE[task.importance].coins;
  const welcomeBack = isAway(activity, now);
  return {
    coins: (bonus ? base * 2 : base) + (welcomeBack ? WELCOME_BACK_COINS : 0),
    growth: bonus ? 2 : 1,
    bonus,
    bonusIndex: bonus ? doneToday + 1 : 0,
    late,
    welcomeBack,
  };
}

export function lastActiveDate(activity: Activity): string | null {
  const days = Object.keys(activity).filter((d) => activity[d] > 0).sort();
  return days.length ? days[days.length - 1] : null;
}

/** The city sleeps after WELCOME_BACK_DAYS without completing anything. */
export function isAway(activity: Activity, now: number): boolean {
  const last = lastActiveDate(activity);
  return last !== null && daysBetween(last, localDate(now)) >= WELCOME_BACK_DAYS;
}

/** Distinct days among the last 7 (including today) with at least one completion. */
export function activeDays(activity: Activity, now: number): number {
  const today = localDate(now);
  let n = 0;
  for (let i = 0; i < 7; i++) if (completionsOn(activity, addDays(today, -i)) > 0) n++;
  return n;
}
