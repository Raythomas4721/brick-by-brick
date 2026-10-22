import { activeDays, isAway, rewardFor } from '../economy/rewards';
import {
  allIntervalSlots, countOn, intervalSlots, occursOn, remindersBetween, repeatLabel, streak, todayOccurrences, type Task,
} from './types';

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).getTime();

function task(p: Partial<Task>): Task {
  return {
    id: 't1', title: 'x', memo: '', category: 'study', importance: 2, repeat: { kind: 'daily' },
    date: null, time: '21:00', remindBefore: 0, createdAt: at(2026, 10, 1), done: [], ...p,
  };
}

describe('occursOn', () => {
  it('handles weekly, monthly and one-off rules', () => {
    const gym = task({ repeat: { kind: 'weekly', days: [1, 3] } }); // Mon, Wed
    expect(occursOn(gym, '2026-10-19')).toBe(true); // Monday
    expect(occursOn(gym, '2026-10-20')).toBe(false); // Tuesday
    expect(occursOn(gym, '2026-10-21')).toBe(true); // Wednesday
    const bill = task({ repeat: { kind: 'monthly', day: 31 } });
    expect(occursOn(bill, '2026-11-30')).toBe(true); // clamps to month end
    const dentist = task({ repeat: { kind: 'none' }, date: '2026-11-05' });
    expect(occursOn(dentist, '2026-11-05')).toBe(true);
    expect(occursOn(dentist, '2026-11-06')).toBe(false);
  });

  it('never occurs before the task was created', () => {
    expect(occursOn(task({}), '2026-09-30')).toBe(false);
  });
});

describe('streak', () => {
  it('counts consecutive days and waits for today', () => {
    const t = task({ done: ['2026-10-17', '2026-10-18', '2026-10-19'] });
    expect(streak(t, at(2026, 10, 20))).toBe(3);
    expect(streak({ ...t, done: [...t.done, '2026-10-20'] }, at(2026, 10, 20))).toBe(4);
  });

  it('forgives one miss per week but not two', () => {
    // Week of Oct 12-18: miss the 15th only -> forgiven
    const one = task({ done: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'] });
    expect(streak(one, at(2026, 10, 20))).toBe(7);
    // Miss the 15th and 17th -> breaks at the 15th... counting back: 19,18 done, 17 forgiven, 16 done, 15 breaks
    const two = task({ done: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-16', '2026-10-18', '2026-10-19'] });
    expect(streak(two, at(2026, 10, 20))).toBe(3);
  });

  it('only looks at scheduled days for weekly habits', () => {
    const gym = task({ repeat: { kind: 'weekly', days: [1, 3] }, done: ['2026-10-12', '2026-10-14', '2026-10-19'] });
    expect(streak(gym, at(2026, 10, 20))).toBe(3);
  });
});

describe('todayOccurrences', () => {
  it('lists today’s habits, due and overdue one-offs, and undated todos', () => {
    const now = at(2026, 10, 20);
    const items = todayOccurrences([
      task({ id: 'eng' }),
      task({ id: 'gym', repeat: { kind: 'weekly', days: [1, 3] } }),
      task({ id: 'old', repeat: { kind: 'none' }, date: '2026-10-18' }),
      task({ id: 'later', repeat: { kind: 'none' }, date: '2026-11-05' }),
      task({ id: 'todo', repeat: { kind: 'none' }, date: null, time: null }),
    ], now);
    expect(items.map((o) => o.task.id)).toEqual(['eng', 'old', 'todo']);
    expect(items.find((o) => o.task.id === 'old')!.overdue).toBe(true);
  });
});

describe('remindersBetween', () => {
  it('produces one reminder per occurrence, skipping completed ones', () => {
    const t = task({ remindBefore: 10, done: ['2026-10-21'] });
    const r = remindersBetween([t], at(2026, 10, 20, 0), at(2026, 10, 22, 23));
    expect(r.map((x) => x.date)).toEqual(['2026-10-20', '2026-10-22']);
    expect(new Date(r[0].at).getHours()).toBe(20);
    expect(new Date(r[0].at).getMinutes()).toBe(50);
  });
});

describe('rewards', () => {
  it('doubles coins and growth for the first three completions of the day', () => {
    const t = task({ importance: 3 });
    expect(rewardFor(t, { '2026-10-20': 2 }, at(2026, 10, 20), false)).toMatchObject({ coins: 100, growth: 2, bonus: true, bonusIndex: 3 });
    expect(rewardFor(t, { '2026-10-20': 3 }, at(2026, 10, 20), false)).toMatchObject({ coins: 50, growth: 1, bonus: false });
  });

  it('welcomes the mayor back after three idle days', () => {
    const activity = { '2026-10-16': 1 };
    expect(isAway(activity, at(2026, 10, 19))).toBe(true);
    expect(isAway(activity, at(2026, 10, 18))).toBe(false);
    expect(rewardFor(task({}), activity, at(2026, 10, 19), false)).toMatchObject({ welcomeBack: true, coins: 180 });
  });

  it('counts active days in the last week', () => {
    expect(activeDays({ '2026-10-20': 1, '2026-10-18': 2, '2026-10-10': 5 }, at(2026, 10, 20))).toBe(2);
  });
});

describe('interval tasks', () => {
  const water = (p: Partial<Task> = {}) =>
    task({
      id: 'water',
      time: null,
      repeat: { kind: 'interval', every: 60, start: '09:00', end: '21:00', skip: ['12:00'], days: [0, 1, 2, 3, 4, 5, 6], goal: 8 },
      ...p,
    });

  it('lists slots from start to end and leaves out skipped ones', () => {
    const r = { every: 60, start: '09:00', end: '13:00', skip: ['12:00'] };
    expect(allIntervalSlots(r)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00']);
    expect(intervalSlots(r)).toEqual(['09:00', '10:00', '11:00', '13:00']);
    expect(allIntervalSlots({ every: 90, start: '09:00', end: '12:00' })).toEqual(['09:00', '10:30', '12:00']);
  });

  it('reminds once per slot with unique keys and skips 12:00', () => {
    const r = remindersBetween([water()], at(2026, 10, 20, 0), at(2026, 10, 20, 23));
    expect(r).toHaveLength(12);
    expect(new Set(r.map((x) => x.key)).size).toBe(12);
    expect(r.map((x) => new Date(x.at).getHours())).not.toContain(12);
    expect(r[0].key).toBe('water_202610200900');
  });

  it('stops reminding once the day’s goal is reached', () => {
    const r = remindersBetween([water({ done: ['2026-10-20'] })], at(2026, 10, 20, 0), at(2026, 10, 21, 23));
    expect(r.every((x) => x.date === '2026-10-21')).toBe(true);
  });

  it('respects the shorter interval horizon and chosen weekdays', () => {
    const weekdaysOnly = water({ repeat: { kind: 'interval', every: 120, start: '09:00', end: '17:00', skip: [], days: [1, 2, 3, 4, 5], goal: 5 } });
    // Sat 24 + Sun 25 are excluded; horizon cut at the 22nd
    const r = remindersBetween([weekdaysOnly], at(2026, 10, 20, 0), at(2026, 10, 26, 23), at(2026, 10, 22, 23));
    expect([...new Set(r.map((x) => x.date))]).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(occursOn(weekdaysOnly, '2026-10-24')).toBe(false);
  });

  it('builds streaks from days the goal was reached', () => {
    expect(streak(water({ done: ['2026-10-18', '2026-10-19'], counts: { '2026-10-20': 3 } }), at(2026, 10, 20))).toBe(2);
    expect(countOn(water({ counts: { '2026-10-20': 3 } }), '2026-10-20')).toBe(3);
  });

  it('describes the schedule', () => {
    expect(repeatLabel(water())).toBe('每天 09:00–21:00 每 1 小時（跳過 12:00）');
  });
});
