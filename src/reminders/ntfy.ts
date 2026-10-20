import { IMPORTANCE, type Reminder } from '../tasks/types';
import type { Settings } from '../storage';
import { formatDate } from '../util';

/** ntfy.sh accepts delays up to 3 days; keep a margin. */
export const NTFY_WINDOW_MS = 71 * 3600_000;
export const NTFY_MIN_DELAY_MS = 15_000;

function base(settings: Settings): string {
  return settings.ntfyServer.replace(/\/+$/, '');
}

/** JSON publishing keeps titles UTF-8 safe and needs no custom headers. */
async function publish(settings: Settings, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(base(settings), {
    method: 'POST',
    body: JSON.stringify({ topic: settings.ntfyTopic, ...payload }),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
}

function body(r: Reminder, showTitle: boolean): { title: string; message: string } {
  const imp = IMPORTANCE[r.task.importance].label;
  const when = `${formatDate(r.date)} ${r.task.time}`;
  const lead = r.task.remindBefore > 0 ? `${when} 要做` : `現在（${when}）`;
  return showTitle
    ? { title: r.task.title, message: `${lead}・${imp}` }
    : { title: '城市提醒', message: `市長，你有一件${imp}重要性的事項${lead}` };
}

/** Schedule (or replace) one occurrence's push. The reminder key doubles as ntfy's sequence id. */
export async function scheduleNtfy(settings: Settings, r: Reminder): Promise<void> {
  await publish(settings, {
    ...body(r, settings.ntfyShowTitle),
    priority: IMPORTANCE[r.task.importance].ntfyPriority,
    tags: ['cityscape'],
    delay: String(Math.floor(r.at / 1000)),
    sequence_id: r.key,
  });
}

export async function cancelNtfy(settings: Settings, key: string): Promise<void> {
  const url = `${base(settings)}/${encodeURIComponent(settings.ntfyTopic)}/${key}`;
  await fetch(url, { method: 'DELETE' }).catch(() => undefined);
}

export async function sendTestNtfy(settings: Settings): Promise<void> {
  await publish(settings, { title: '積木城市', message: '測試成功！之後的提醒會推播到這裡。' });
}
