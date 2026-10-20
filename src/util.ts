export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + n);
  return localDate(d.getTime());
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return parseDate(date).getDay();
}

export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

export function daysInMonth(date: string): number {
  const d = parseDate(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Monday of the week containing `date`, used to group "one free miss per week". */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Timestamp for a local date + "HH:MM". */
export function dateTime(date: string, time: string): number {
  const d = parseDate(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function formatDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

export function formatRelative(ms: number): string {
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  let s: string;
  if (min < 60) s = `${min} 分鐘`;
  else if (min < 1440) s = `${Math.round(min / 60)} 小時`;
  else s = `${Math.round(min / 1440)} 天`;
  return ms >= 0 ? `${s}後` : `${s}前`;
}
