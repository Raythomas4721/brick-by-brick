import { useState } from 'react';
import {
  CATEGORIES, IMPORTANCE, INTERVAL_OPTIONS, REMIND_OPTIONS, WEEKDAYS, allIntervalSlots,
  type Category, type Importance, type Repeat, type Task,
} from '../tasks/types';
import type { TaskInput } from '../useApp';
import { localDate, weekday } from '../util';

interface Props {
  initial?: Task;
  onSubmit: (input: TaskInput) => void;
  onCancel?: () => void;
}

type RepeatKind = Repeat['kind'];

const REPEAT_LABELS: Record<RepeatKind, string> = { none: '單次', daily: '每天', weekly: '每週', monthly: '每月', interval: '間隔' };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export default function TaskForm({ initial, onSubmit, onCancel }: Props) {
  const today = localDate(Date.now());
  const [title, setTitle] = useState(initial?.title ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [category, setCategory] = useState<Category>(initial?.category ?? 'life');
  const [importance, setImportance] = useState<Importance>(initial?.importance ?? 2);
  const [kind, setKind] = useState<RepeatKind>(initial?.repeat.kind ?? 'none');
  const [days, setDays] = useState<number[]>(initial?.repeat.kind === 'weekly' ? initial.repeat.days : [weekday(today)]);
  const [monthDay, setMonthDay] = useState(initial?.repeat.kind === 'monthly' ? initial.repeat.day : Number(today.slice(8)));
  const [date, setDate] = useState(initial?.date ?? '');
  const [time, setTime] = useState(initial?.time ?? '');
  const [remindBefore, setRemindBefore] = useState(initial?.remindBefore ?? 0);
  const iv = initial?.repeat.kind === 'interval' ? initial.repeat : null;
  const [every, setEvery] = useState(iv?.every ?? 60);
  const [start, setStart] = useState(iv?.start ?? '09:00');
  const [end, setEnd] = useState(iv?.end ?? '21:00');
  const [skip, setSkip] = useState<string[]>(iv?.skip ?? []);
  const [ivDays, setIvDays] = useState<number[]>(iv?.days ?? ALL_DAYS);
  const [goal, setGoal] = useState<number | null>(iv?.goal ?? null); // null = one per reminder

  const slots = start && end && start < end ? allIntervalSlots({ every, start, end }) : [];
  const activeSlots = slots.filter((x) => !skip.includes(x));
  const goalValue = Math.max(1, Math.min(goal ?? activeSlots.length, 50));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || (kind === 'weekly' && days.length === 0)) return;
    if (kind === 'interval' && (activeSlots.length === 0 || ivDays.length === 0)) return;
    const repeat: Repeat =
      kind === 'weekly' ? { kind, days }
      : kind === 'monthly' ? { kind, day: monthDay }
      : kind === 'interval' ? { kind, every, start, end, skip: skip.filter((x) => slots.includes(x)), days: ivDays, goal: goalValue }
      : { kind } as Repeat;
    onSubmit({
      title: title.trim(),
      memo: memo.trim(),
      category,
      importance,
      repeat,
      date: kind === 'none' && date ? date : null,
      time: kind === 'interval' ? null : time || null,
      remindBefore,
    });
    if (!initial) {
      setTitle('');
      setMemo('');
      setDate('');
    }
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const toggleDay = (d: number) => setDays((cur) => toggle(cur, d));

  return (
    <form className="card task-form" onSubmit={submit}>
      <input className="title-input" placeholder="要做什麼？例如：練習英文、去看牙" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required />

      <div className="segmented" role="radiogroup" aria-label="重複">
        {(Object.keys(REPEAT_LABELS) as RepeatKind[]).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {REPEAT_LABELS[k]}
          </button>
        ))}
      </div>

      {kind === 'weekly' && (
        <div className="weekdays" role="group" aria-label="星期">
          {WEEK_ORDER.map((d) => (
            <button type="button" key={d} aria-pressed={days.includes(d)} className={days.includes(d) ? 'on' : ''} onClick={() => toggleDay(d)}>
              {WEEKDAYS[d]}
            </button>
          ))}
        </div>
      )}

      {kind === 'interval' && (
        <div className="interval-box">
          <div className="form-row">
            <label>
              每隔
              <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                {INTERVAL_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
              </select>
            </label>
            <label>
              從
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              到
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <div className="weekdays" role="group" aria-label="哪幾天">
            {WEEK_ORDER.map((d) => (
              <button type="button" key={d} aria-pressed={ivDays.includes(d)} className={ivDays.includes(d) ? 'on' : ''} onClick={() => setIvDays((cur) => toggle(cur, d))}>
                {WEEKDAYS[d]}
              </button>
            ))}
          </div>
          {slots.length === 0 ? (
            <p className="hint">「到」要晚於「從」。</p>
          ) : (
            <>
              <p className="hint">點時段可以跳過（例如午餐 12:00）：</p>
              <div className="slots" role="group" aria-label="提醒時段">
                {slots.map((x) => (
                  <button type="button" key={x} aria-pressed={!skip.includes(x)} className={skip.includes(x) ? 'skip' : 'on'} onClick={() => setSkip((cur) => toggle(cur, x))}>
                    {x}
                  </button>
                ))}
              </div>
              <label className="goal">
                每天目標
                <input type="number" min={1} max={50} value={goalValue} onChange={(e) => setGoal(Number(e.target.value) || 1)} />
                <span className="hint">次（共 {activeSlots.length} 個提醒）</span>
              </label>
            </>
          )}
        </div>
      )}

      <div className="form-row">
        {kind === 'none' && (
          <label>
            日期（可不填）
            <input type="date" value={date} min={initial ? undefined : today} onChange={(e) => setDate(e.target.value)} />
          </label>
        )}
        {kind === 'monthly' && (
          <label>
            每月幾號
            <select value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d} 號</option>)}
            </select>
          </label>
        )}
        {kind !== 'interval' && (<>
        <label>
          時間（填了才會提醒）
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label>
          提醒
          <select value={remindBefore} onChange={(e) => setRemindBefore(Number(e.target.value))} disabled={!time}>
            {REMIND_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
          </select>
        </label>
        </>)}
      </div>

      <div className="form-row">
        <div className="segmented" role="radiogroup" aria-label="分類">
          {(Object.keys(CATEGORIES) as Category[]).map((c) => (
            <button type="button" key={c} role="radio" aria-checked={category === c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>
              {CATEGORIES[c].icon} {CATEGORIES[c].label}
            </button>
          ))}
        </div>
        <div className="segmented imp" role="radiogroup" aria-label="重要性">
          {([1, 2, 3, 4] as Importance[]).map((lv) => (
            <button
              type="button" key={lv} role="radio" aria-checked={importance === lv}
              className={importance === lv ? 'on' : ''}
              style={{ '--c': IMPORTANCE[lv].color } as React.CSSProperties}
              onClick={() => setImportance(lv)}
            >
              {IMPORTANCE[lv].label}
            </button>
          ))}
        </div>
      </div>

      <textarea placeholder="備註（選填）" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={500} />

      <div className="form-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>取消</button>}
        <button type="submit" className="primary">{initial ? '儲存' : '新增'}</button>
      </div>
    </form>
  );
}
