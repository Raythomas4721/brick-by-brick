import type { Task } from '../tasks/types';
import { addDays, daysBetween, localDate } from '../util';

/** The first three completions each day are the day's "三大建設" and earn a booster. */
export const BONUS_PER_DAY = 3;
export const WELCOME_BACK_DAYS = 3;
export const WELCOME_BACK_HEARTS = 3;
export const HEART_CAP = 30;
export const DAILY_FREE_HEARTS = 2;
/** Habit streak milestones that award a rare rainbow brick. */
export const STREAK_TIERS = [7, 30, 100];

export type Booster = 'hammer' | 'shuffle' | 'moves' | 'rainbow';

export const BOOSTERS: Record<Booster, { icon: string; label: string; hint: string }> = {
  hammer: { icon: '🔨', label: '鎚子', hint: '點一格敲掉它（木箱扣一層）' },
  shuffle: { icon: '🔀', label: '洗牌', hint: '重新排列所有積木' },
  moves: { icon: '➕', label: '+5 步', hint: '多 5 步；沒步數時可以接關' },
  rainbow: { icon: '💎', label: '彩虹積木', hint: '把一格變成彩虹積木' },
};

const COMMON_BOOSTERS: Booster[] = ['hammer', 'shuffle', 'moves'];

export function randomBooster(roll: number): Booster {
  return COMMON_BOOSTERS[Math.min(COMMON_BOOSTERS.length - 1, Math.floor(roll * COMMON_BOOSTERS.length))];
}

/** Completions per local date. */
export type Activity = Record<string, number>;

export function completionsOn(activity: Activity, date: string): number {
  return activity[date] ?? 0;
}

export function streakTier(streak: number): number {
  return STREAK_TIERS.filter((n) => streak >= n).length;
}

export interface Reward {
  hearts: number;
  booster: Booster | null; // one of today's first three earns a booster
  bonus: boolean;
  bonusIndex: number; // 1-3 when bonus
  late: boolean;
  welcomeBack: boolean;
}

/**
 * Reward for completing `task`. `late` = a dated one-off finished after its day:
 * still a heart, but no daily bonus. `roll` picks the booster (injectable for tests).
 */
export function rewardFor(_task: Task, activity: Activity, now: number, late: boolean, roll = Math.random()): Reward {
  const doneToday = completionsOn(activity, localDate(now));
  const bonus = !late && doneToday < BONUS_PER_DAY;
  const welcomeBack = isAway(activity, now);
  return {
    hearts: 1 + (welcomeBack ? WELCOME_BACK_HEARTS : 0),
    booster: bonus ? randomBooster(roll) : null,
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

/** Back after WELCOME_BACK_DAYS without completing anything. */
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
